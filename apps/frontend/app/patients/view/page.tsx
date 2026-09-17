'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Link from 'next/link';
import { FileDown, Trash2, Upload } from 'lucide-react';
import { useAuth } from '@/lib/useAuth';
import { calculateAgeYears } from '@/lib/age';
import { validateReproductiveHealthForm } from '@/lib/reproductive-health-validation';

const DOCUMENT_CATEGORIES = [
  { value: 'LAB_RESULT', label: 'Lab Result' },
  { value: 'CONSENT_FORM', label: 'Consent Form' },
  { value: 'ID_COPY', label: 'ID Copy' },
  { value: 'REFERRAL_LETTER', label: 'Referral Letter' },
  { value: 'OTHER', label: 'Other' },
];

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

  useEffect(() => {
    if (patientId) {
      fetchPatientHistory();
      fetchDocuments();
    }
  }, [patientId]);

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

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  if (!patient) return <div className="p-8">Patient not found</div>;

  const canEditClinicalData = hasRole('NURSE', 'DOCTOR', 'ADMIN');

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
                    <select
                      id="familyPlanningMethod"
                      value={rhForm.familyPlanningMethod}
                      onChange={(e) => setRhForm((f) => ({ ...f, familyPlanningMethod: e.target.value }))}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                    >
                      {['NONE', 'CONDOM', 'PILL', 'INJECTABLE', 'IMPLANT', 'IUD', 'NATURAL', 'PERMANENT', 'OTHER'].map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="pregnancyStatus">Pregnancy Status</Label>
                    <select
                      id="pregnancyStatus"
                      value={rhForm.pregnancyStatus}
                      onChange={(e) => setRhForm((f) => ({ ...f, pregnancyStatus: e.target.value }))}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                    >
                      {['UNKNOWN', 'NOT_PREGNANT', 'PREGNANT', 'POSTPARTUM'].map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
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
              <select
                value={uploadCategory}
                onChange={(e) => setUploadCategory(e.target.value)}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
                disabled={uploading}
              >
                {DOCUMENT_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleUploadDocument}
                disabled={uploading}
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
              <span className="text-xs text-muted-foreground">Max 10MB</span>
            </div>
          )}

          {documentsLoading ? (
            <p className="text-sm text-muted-foreground">Loading documents...</p>
          ) : documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents uploaded yet</p>
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex justify-between items-center bg-slate-50 dark:bg-slate-800 p-3 rounded text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{doc.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {DOCUMENT_CATEGORIES.find((c) => c.value === doc.category)?.label || doc.category}
                      {' · '}{formatFileSize(doc.fileSize)}
                      {' · '}{new Date(doc.createdAt).toLocaleDateString()}
                      {doc.uploadedBy?.name ? ` · ${doc.uploadedBy.name}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-1 items-center shrink-0 ml-3">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={downloadingDocId === doc.id}
                      onClick={() => handleDownloadDocument(doc.id, doc.fileName)}
                      title="Download"
                    >
                      <FileDown className="size-4" aria-hidden="true" />
                    </Button>
                    {canEditClinicalData && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        disabled={deletingDocId === doc.id}
                        onClick={() => handleDeleteDocument(doc.id)}
                        title="Delete"
                        className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/50"
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                </div>
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
                <div className="mb-4">
                  <div className="flex justify-between items-start">
                    <h3 className="font-bold text-lg">{consult.diagnosis}</h3>
                    <p className="text-sm text-muted-foreground">
                      {new Date(consult.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="mb-4">
                  <p className="text-sm"><strong>Symptoms:</strong> {consult.symptoms}</p>
                </div>

                {consult.prescriptions.length > 0 && (
                  <div className="mb-4">
                    <h4 className="font-semibold mb-2">Prescriptions:</h4>
                    {consult.prescriptions.map((rx: any) => (
                      <div key={rx.id} className="bg-slate-50 dark:bg-slate-800 p-3 rounded mb-2">
                        <p className="font-medium">{rx.medication}</p>
                        <p className="text-sm text-muted-foreground">
                          {rx.dosage} • {rx.frequency} • {rx.duration}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

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
      </div>
    </div>
  );
}
