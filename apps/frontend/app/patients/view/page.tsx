'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Link from 'next/link';
import { Upload } from 'lucide-react';
import { DocumentItem } from '@/components/document-item';
import { DOCUMENT_ACCEPT, DOCUMENT_TYPES_HELP, openDocumentPreview } from '@/lib/document-preview';
import { useAuth } from '@/lib/useAuth';
import { calculateAgeYears } from '@/lib/age';
import { validateReproductiveHealthForm } from '@/lib/reproductive-health-validation';
import { CommentsSection } from '@/components/comments-section';
import { Select } from '@/components/ui/select';
import { ConsultationDetails } from '@/components/consultation-details';
import { AllergyPanel } from '@/components/allergy-panel';

const DOCUMENT_CATEGORIES = [
  { value: 'LAB_RESULT', label: 'Lab Result' },
  { value: 'CONSENT_FORM', label: 'Consent Form' },
  { value: 'ID_COPY', label: 'ID Copy' },
  { value: 'REFERRAL_LETTER', label: 'Referral Letter' },
  { value: 'PATIENT_UPLOAD', label: 'Uploaded by patient' },
  { value: 'OTHER', label: 'Other' },
];

// PATIENT_UPLOAD is set automatically by the patient-portal upload route,
// never chosen by staff - excluded here so staff can't mislabel their own
// upload's provenance.
const STAFF_DOCUMENT_CATEGORIES = DOCUMENT_CATEGORIES.filter((c) => c.value !== 'PATIENT_UPLOAD');

export default function PatientHistoryPage() {
  return (
    <Suspense fallback={<div className="p-8">Loading...</div>}>
      <PatientHistoryContent />
    </Suspense>
  );
}

function PatientHistoryContent() {
  const searchParams = useSearchParams();
  const patientId = searchParams.get('id') || '';
  const { hasRole } = useAuth();

  const [patient, setPatient] = useState<any>(null);
  const [consultations, setConsultations] = useState([]);
  const [reproductiveHealthRecords, setReproductiveHealthRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRhForm, setShowRhForm] = useState(false);
  const [rhSaving, setRhSaving] = useState(false);
  const [rhForm, setRhForm] = useState({
    lastMenstrualPeriodDate: '',
    cycleLengthDays: '',
    flowDurationDays: '',
    familyPlanningMethod: 'NONE',
    pregnancyStatus: 'UNKNOWN',
    gravida: '',
    para: '',
    notes: '',
  });

  const [documents, setDocuments] = useState<any[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [uploadCategory, setUploadCategory] = useState('OTHER');
  const [uploading, setUploading] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [portalAccount, setPortalAccount] = useState<{ portableId: string; status: string; activated?: boolean } | null>(null);
  const [resendingInvite, setResendingInvite] = useState(false);
  const [showPortalForm, setShowPortalForm] = useState(false);
  const [portalPhone, setPortalPhone] = useState('');
  const [portalEmail, setPortalEmail] = useState('');
  const [creatingPortalAccount, setCreatingPortalAccount] = useState(false);

  useEffect(() => {
    if (patientId) {
      fetchPatientHistory();
      fetchDocuments();
      fetchPortalAccount();
    }
  }, [patientId]);

  const fetchPortalAccount = async () => {
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patients/${patientId}/portal-account`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) setPortalAccount(data.account);
    } catch (error) {
      console.error(error);
    }
  };

  const handleResendInvitation = async () => {
    setResendingInvite(true);
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patients/${patientId}/portal-account/resend`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Could not resend the email');
      alert('The set-up email has been sent again.');
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    } finally {
      setResendingInvite(false);
    }
  };

  const handleCreatePortalAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingPortalAccount(true);
    const token = localStorage.getItem('token');

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patients/${patientId}/portal-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ phone: portalPhone, email: portalEmail }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to create portal account');

      setPortalAccount({ portableId: data.portableId, status: 'ACTIVE', activated: false });
      setShowPortalForm(false);
      alert(`Portal account created. Patient ID: ${data.portableId}. An email with a set-password link was sent to ${portalEmail}.`);
    } catch (error: any) {
      alert(`Error creating portal account: ${error.message}`);
    } finally {
      setCreatingPortalAccount(false);
    }
  };

  const fetchDocuments = async () => {
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patients/${patientId}/documents`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) setDocuments(data.documents);
    } catch (error) {
      console.error(error);
    } finally {
      setDocumentsLoading(false);
    }
  };

  const handleUploadDocument = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      alert('File is too large (10MB max)');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const token = localStorage.getItem('token');
    const formData = new FormData();
    formData.append('category', uploadCategory);
    formData.append('file', file);

    setUploading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patients/${patientId}/documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Upload failed');
      setDocuments((prev) => [data.document, ...prev]);
    } catch (error: any) {
      alert(`Error uploading document: ${error.message}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDownloadDocument = async (docId: string, fileName: string) => {
    const token = localStorage.getItem('token');
    setDownloadingDocId(docId);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/documents/${docId}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert('Error downloading document');
    } finally {
      setDownloadingDocId(null);
    }
  };

  const [printingRxId, setPrintingRxId] = useState<string | null>(null);

  const handlePrintPrescription = async (consultationId: string) => {
    setPrintingRxId(consultationId);
    try {
      await openDocumentPreview(`${process.env.NEXT_PUBLIC_API_URL}/consultations/${consultationId}/prescription/pdf`, localStorage.getItem('token'));
    } catch (error: any) {
      alert(error.message);
    } finally {
      setPrintingRxId(null);
    }
  };

  const handleViewDocument = async (docId: string) => {
    try {
      await openDocumentPreview(`${process.env.NEXT_PUBLIC_API_URL}/documents/${docId}/download`, localStorage.getItem('token'));
    } catch (error: any) {
      alert(error.message);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    if (!confirm('Delete this document? This cannot be undone.')) return;
    const token = localStorage.getItem('token');
    setDeletingDocId(docId);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/documents/${docId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Delete failed');
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
    } catch (error: any) {
      alert(`Error deleting document: ${error.message}`);
    } finally {
      setDeletingDocId(null);
    }
  };

  const fetchPatientHistory = async () => {
    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };

    try {
      const [patientRes, consultRes] = await Promise.all([
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/patients/record/${patientId}`, { headers }),
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/consultations/patient/${patientId}`, { headers }),
      ]);
      const patientData = await patientRes.json();
      const foundPatient = patientData.success ? patientData.patient : null;
      setPatient(foundPatient);

      const consultData = await consultRes.json();
      if (consultData.success) setConsultations(consultData.consultations);

      if (foundPatient?.sex === 'FEMALE') {
        const rhRes = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/patients/${patientId}/reproductive-health`,
          { headers }
        );
        const rhData = await rhRes.json();
        if (rhData.success) setReproductiveHealthRecords(rhData.records);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const [rhErrors, setRhErrors] = useState<Record<string, string>>({});

  const handleAddReproductiveHealth = async (e: React.FormEvent) => {
    e.preventDefault();

    const validation = validateReproductiveHealthForm({
      cycleLengthDays: rhForm.cycleLengthDays,
      flowDurationDays: rhForm.flowDurationDays,
      gravida: rhForm.gravida,
      para: rhForm.para,
    });
    setRhErrors(validation.errors as Record<string, string>);
    if (!validation.valid) return;

    setRhSaving(true);
    const token = localStorage.getItem('token');

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/patients/${patientId}/reproductive-health`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            lastMenstrualPeriodDate: rhForm.lastMenstrualPeriodDate || undefined,
            cycleLengthDays: rhForm.cycleLengthDays ? Number(rhForm.cycleLengthDays) : undefined,
            flowDurationDays: rhForm.flowDurationDays ? Number(rhForm.flowDurationDays) : undefined,
            familyPlanningMethod: rhForm.familyPlanningMethod,
            pregnancyStatus: rhForm.pregnancyStatus,
            gravida: rhForm.gravida ? Number(rhForm.gravida) : undefined,
            para: rhForm.para ? Number(rhForm.para) : undefined,
            notes: rhForm.notes || undefined,
          }),
        }
      );
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to save record');

      setReproductiveHealthRecords((prev) => [data.record, ...prev]);
      setShowRhForm(false);
      setRhForm({
        lastMenstrualPeriodDate: '',
        cycleLengthDays: '',
        flowDurationDays: '',
        familyPlanningMethod: 'NONE',
        pregnancyStatus: 'UNKNOWN',
        gravida: '',
        para: '',
        notes: '',
      });
    } catch (error: any) {
      alert(`Error saving record: ${error.message}`);
    } finally {
      setRhSaving(false);
    }
  };

  if (loading) return <div className="p-8">Loading...</div>;
  if (!patient) {
    return (
      <div className="p-8 space-y-3">
        <p className="font-medium">This patient record could not be loaded.</p>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          If it was just registered offline, it becomes available here once it has synced. Otherwise, check your
          connection and try again.
        </p>
        <Link href="/patients">
          <Button variant="outline" size="sm">Back to patients</Button>
        </Link>
      </div>
    );
  }

  const canEditClinicalData = hasRole('NURSE', 'DOCTOR', 'ADMIN');
  // Front desk registers and verifies patients at reception, so they manage
  // the patient's portal account too (but not clinical data).
  const canManagePortal = hasRole('NURSE', 'DOCTOR', 'ADMIN', 'STAFF');

  return (
    <div className="min-h-screen p-8 bg-slate-50 dark:bg-slate-950">
      <div className="max-w-4xl mx-auto">
        <Link href="/patients">
          <Button variant="outline" className="mb-4">← Back to Patients</Button>
        </Link>

        <Card className="p-6 mb-6">
          <h1 className="text-3xl font-bold mb-2">{patient.name}</h1>
          <p className="text-muted-foreground">{patient.phone}</p>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm mt-3 text-slate-600 dark:text-slate-400">
            {patient.sex && <span>Sex: {patient.sex}</span>}
            {patient.dateOfBirth && <span>Age: {calculateAgeYears(patient.dateOfBirth)} years</span>}
            {(patient.village || patient.parish || patient.subCounty || patient.district) && (
              <span>
                Address: {[patient.village, patient.parish, patient.subCounty, patient.district].filter(Boolean).join(', ')}
              </span>
            )}
          </div>
          <p className="text-sm mt-2 text-slate-500 dark:text-slate-400">
            Patient since {new Date(patient.createdAt).toLocaleDateString()}
          </p>

          <div className="mt-4">
            <AllergyPanel
              patientId={patient.id}
              clinicId={patient.clinicId}
              record={patient}
              canEdit={hasRole('NURSE', 'DOCTOR', 'PHARMACIST', 'ADMIN')}
              onSaved={(next) => setPatient((p: any) => (p ? { ...p, allergyStatus: next.allergyStatus, allergies: next.allergies } : p))}
            />
          </div>

          <div className="mt-4 border-t pt-4">
            {portalAccount ? (
              <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600 dark:text-slate-400">
                <span>
                  Patient portal: <span className="font-mono font-medium text-emerald-700 dark:text-emerald-500">{portalAccount.portableId}</span>
                  {portalAccount.status !== 'ACTIVE' && <span className="ml-2 text-amber-600">({portalAccount.status})</span>}
                </span>
                {portalAccount.activated === false && (
                  <>
                    <span className="text-amber-600">Invitation sent - awaiting activation</span>
                    {canManagePortal && (
                      <Button size="sm" variant="outline" disabled={resendingInvite} onClick={handleResendInvitation}>
                        {resendingInvite ? 'Sending...' : 'Resend set-up email'}
                      </Button>
                    )}
                  </>
                )}
                {portalAccount.activated === true && <span className="text-emerald-700 dark:text-emerald-500">Activated</span>}
              </div>
            ) : canManagePortal ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (!showPortalForm) {
                      setPortalPhone((current) => current || patient.phone || '');
                      setPortalEmail((current) => current || patient.email || '');
                    }
                    setShowPortalForm((v) => !v);
                  }}
                >
                  {showPortalForm ? 'Cancel' : 'Create portal account'}
                </Button>
                {showPortalForm && (
                  <form onSubmit={handleCreatePortalAccount} className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="portalPhone">Phone</Label>
                      <Input id="portalPhone" required value={portalPhone} onChange={(e) => setPortalPhone(e.target.value)} placeholder="0700000000" />
                    </div>
                    <div>
                      <Label htmlFor="portalEmail">Email</Label>
                      <Input id="portalEmail" type="email" required value={portalEmail} onChange={(e) => setPortalEmail(e.target.value)} />
                    </div>
                    <Button type="submit" size="sm" className="sm:col-span-2 w-fit" disabled={creatingPortalAccount}>
                      {creatingPortalAccount ? 'Creating...' : 'Create account'}
                    </Button>
                  </form>
                )}
              </>
            ) : null}
          </div>
        </Card>

        {patient.sex === 'FEMALE' && (
          <Card className="p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Reproductive Health</h2>
              {canEditClinicalData && (
                <Button size="sm" onClick={() => setShowRhForm((v) => !v)}>
                  {showRhForm ? 'Cancel' : 'Add Record'}
                </Button>
              )}
            </div>

            {showRhForm && (
              <form onSubmit={handleAddReproductiveHealth} className="space-y-3 mb-6 border-b pb-6">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="lmp">Last Menstrual Period</Label>
                    <Input
                      id="lmp"
                      type="date"
                      value={rhForm.lastMenstrualPeriodDate}
                      onChange={(e) => setRhForm((f) => ({ ...f, lastMenstrualPeriodDate: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="cycleLength">Cycle Length (days)</Label>
                    <Input
                      id="cycleLength"
                      type="number"
                      min={1}
                      value={rhForm.cycleLengthDays}
                      onChange={(e) => setRhForm((f) => ({ ...f, cycleLengthDays: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="flowDuration">Flow Duration (days)</Label>
                    <Input
                      id="flowDuration"
                      type="number"
                      min={1}
                      value={rhForm.flowDurationDays}
                      onChange={(e) => setRhForm((f) => ({ ...f, flowDurationDays: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="familyPlanningMethod">Family Planning Method</Label>
                    <Select
                      id="familyPlanningMethod"
                      value={rhForm.familyPlanningMethod}
                      onChange={(e) => setRhForm((f) => ({ ...f, familyPlanningMethod: e.target.value }))}
                    >
                      {['NONE', 'CONDOM', 'PILL', 'INJECTABLE', 'IMPLANT', 'IUD', 'NATURAL', 'PERMANENT', 'OTHER'].map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="pregnancyStatus">Pregnancy Status</Label>
                    <Select
                      id="pregnancyStatus"
                      value={rhForm.pregnancyStatus}
                      onChange={(e) => setRhForm((f) => ({ ...f, pregnancyStatus: e.target.value }))}
                    >
                      {['UNKNOWN', 'NOT_PREGNANT', 'PREGNANT', 'POSTPARTUM'].map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="gravida">Gravida</Label>
                      <Input
                        id="gravida"
                        type="number"
                        min={0}
                        value={rhForm.gravida}
                        onChange={(e) => setRhForm((f) => ({ ...f, gravida: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label htmlFor="para">Para</Label>
                      <Input
                        id="para"
                        type="number"
                        min={0}
                        value={rhForm.para}
                        onChange={(e) => setRhForm((f) => ({ ...f, para: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>
                <div>
                  <Label htmlFor="notes">Notes</Label>
                  <Input
                    id="notes"
                    value={rhForm.notes}
                    onChange={(e) => setRhForm((f) => ({ ...f, notes: e.target.value }))}
                  />
                </div>
                <Button type="submit" disabled={rhSaving}>
                  {rhSaving ? 'Saving...' : 'Save Record'}
                </Button>
              </form>
            )}

            {reproductiveHealthRecords.length === 0 ? (
              <p className="text-sm text-muted-foreground">No reproductive health records yet</p>
            ) : (
              <div className="space-y-3">
                {reproductiveHealthRecords.map((record) => (
                  <div key={record.id} className="bg-slate-50 dark:bg-slate-800 p-3 rounded text-sm">
                    <div className="flex justify-between">
                      <span className="font-medium">
                        {record.pregnancyStatus} · {record.familyPlanningMethod}
                      </span>
                      <span className="text-muted-foreground">
                        {new Date(record.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    {record.lastMenstrualPeriodDate && (
                      <p className="text-muted-foreground mt-1">
                        LMP: {new Date(record.lastMenstrualPeriodDate).toLocaleDateString()}
                        {record.cycleLengthDays ? ` · Cycle: ${record.cycleLengthDays}d` : ''}
                        {record.flowDurationDays ? ` · Flow: ${record.flowDurationDays}d` : ''}
                      </p>
                    )}
                    {(record.gravida != null || record.para != null) && (
                      <p className="text-muted-foreground">
                        {record.gravida != null ? `Gravida: ${record.gravida} ` : ''}
                        {record.para != null ? `Para: ${record.para}` : ''}
                      </p>
                    )}
                    {record.notes && <p className="mt-1">{record.notes}</p>}
                    {record.recordedBy?.name && (
                      <p className="text-xs text-muted-foreground mt-1">Recorded by {record.recordedBy.name}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        <Card className="p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold">Documents</h2>
          </div>

          {canEditClinicalData && (
            <div className="flex flex-wrap gap-2 items-center mb-4 pb-4 border-b">
              <Select
                value={uploadCategory}
                onChange={(e) => setUploadCategory(e.target.value)}
                className="w-auto"
                disabled={uploading}
              >
                {STAFF_DOCUMENT_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </Select>
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleUploadDocument}
                disabled={uploading}
                accept={DOCUMENT_ACCEPT}
                className="hidden"
                id="document-upload-input"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="size-4" aria-hidden="true" />
                {uploading ? 'Uploading...' : 'Upload Document'}
              </Button>
              <span className="text-xs text-muted-foreground">{DOCUMENT_TYPES_HELP}</span>
            </div>
          )}

          {documentsLoading ? (
            <p className="text-sm text-muted-foreground">Loading documents...</p>
          ) : documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents uploaded yet</p>
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => (
                <DocumentItem
                  key={doc.id}
                  fileName={doc.fileName}
                  fileSize={doc.fileSize}
                  format={doc.format}
                  busy={downloadingDocId === doc.id || deletingDocId === doc.id}
                  detail={
                    <>
                      {DOCUMENT_CATEGORIES.find((c) => c.value === doc.category)?.label || doc.category}
                      {' · '}{new Date(doc.createdAt).toLocaleDateString()}
                      {doc.uploadedBy?.name ? ` · ${doc.uploadedBy.name}` : ''}
                      {doc.uploadedByPatientAccount ? ` · Uploaded by patient (${doc.uploadedByPatientAccount.portableId})` : ''}
                    </>
                  }
                  onView={() => handleViewDocument(doc.id)}
                  onDownload={() => handleDownloadDocument(doc.id, doc.fileName)}
                  onDelete={canEditClinicalData ? () => handleDeleteDocument(doc.id) : undefined}
                />
              ))}
            </div>
          )}
        </Card>

        <h2 className="text-xl font-bold mb-4">Medical History ({consultations.length} visits)</h2>

        {consultations.length === 0 ? (
          <p>No consultation history</p>
        ) : (
          <div className="space-y-4">
            {consultations.map((consult: any) => (
              <Card key={consult.id} className="p-6">
                <div className="mb-4 flex justify-between items-start gap-3">
                  <div>
                    <h3 className="font-bold text-lg">Visit on {new Date(consult.createdAt).toLocaleDateString()}</h3>
                    {consult.appointment?.doctor?.name && (
                      <p className="text-sm text-muted-foreground">Seen by {consult.appointment.doctor.name}</p>
                    )}
                  </div>
                </div>

                <div className="mb-4">
                  <ConsultationDetails
                    consultation={consult}
                    onPrintPrescription={() => handlePrintPrescription(consult.id)}
                    printing={printingRxId === consult.id}
                  />
                </div>

                {consult.invoice && (
                  <div className="border-t pt-4">
                    <p className="text-sm">
                      <strong>Fee:</strong> UGX {consult.invoice.amount.toLocaleString()}
                      <span className={`ml-2 px-2 py-1 rounded text-xs ${
                        consult.invoice.status === 'PAID' ? 'bg-green-100 dark:bg-green-900' : 'bg-yellow-100 dark:bg-yellow-900'
                      }`}>
                        {consult.invoice.status}
                      </span>
                    </p>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}

        {patientId && (
          <div className="mt-6">
            <CommentsSection
              entityType="PATIENT"
              entityId={patientId}
              title="Care team notes"
              placeholder="Leave a note for the rest of the care team..."
            />
          </div>
        )}
      </div>
    </div>
  );
}
