'use client';

import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Building2, CalendarClock, CalendarPlus, FlaskConical, Paperclip, Stethoscope, Upload } from 'lucide-react';
import { DocumentItem, type DocumentFormat } from '@/components/document-item';
import { ConsultationDetails } from '@/components/consultation-details';
import type { DiagnosisView } from '@/lib/diagnosis';
import type { PrescriptionView } from '@/lib/prescription';
import { DOCUMENT_ACCEPT, DOCUMENT_TYPES_HELP, openDocumentPreview } from '@/lib/document-preview';

const DOCUMENT_CATEGORY_LABELS: Record<string, string> = {
  LAB_RESULT: 'Lab Result',
  CONSENT_FORM: 'Consent Form',
  ID_COPY: 'ID Copy',
  REFERRAL_LETTER: 'Referral Letter',
  PATIENT_UPLOAD: 'Uploaded by you',
  OTHER: 'Other',
};

type Document = {
  id: string;
  category: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
  uploadedByPatientAccountId: string | null;
  format?: DocumentFormat;
};

type AppointmentRequest = {
  id: string;
  preferredDate: string;
  preferredTime: string | null;
  reason: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED';
  declineReason: string | null;
  createdAt: string;
};

type PatientRecord = {
  id: string;
  name: string;
  clinic: { id: string; name: string; facilityType: string };
  allergyStatus?: 'UNKNOWN' | 'NONE_KNOWN' | 'KNOWN';
  allergies?: Array<{ substance: string; reaction?: string | null; severity?: 'MILD' | 'MODERATE' | 'SEVERE' | null }> | null;
  appointments: Array<{ id: string; date: string; time: string; status: string; notes: string | null; doctor: { name: string } }>;
  consultations: Array<{
    id: string; diagnosis: string; symptoms: string; createdAt: string;
    diagnoses: DiagnosisView[];
    prescriptions: Array<PrescriptionView & { id: string }>;
    invoice: { id: string; amount: number; status: string; createdAt: string } | null;
  }>;
  labTests: Array<{ id: string; testName: string; results: string; status: string; createdAt: string }>;
  appointmentRequests: AppointmentRequest[];
  documents: Document[];
};

type MeResponse = {
  account: { portableId: string; email: string; phone: string; createdAt: string };
  records: PatientRecord[];
};

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'text-amber-600 dark:text-amber-400',
  ACCEPTED: 'text-emerald-700 dark:text-emerald-500',
  DECLINED: 'text-rose-600 dark:text-rose-400',
  CANCELLED: 'text-slate-400',
};

export default function PatientPortalDashboardPage() {
  const [data, setData] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [uploadingRecordId, setUploadingRecordId] = useState<string | null>(null);
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({} as any);

  const [requestFormFor, setRequestFormFor] = useState<string | null>(null);
  const [requestDate, setRequestDate] = useState('');
  const [requestTime, setRequestTime] = useState('');
  const [requestReason, setRequestReason] = useState('');
  const [submittingRequest, setSubmittingRequest] = useState(false);

  const fetchMe = async () => {
    const token = localStorage.getItem('patientToken');
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patient-portal/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (body.success) setData(body);
      else setError(body.error || 'Unable to load your records');
    } catch {
      setError('Unable to reach the Bulamu API');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMe();
  }, []);

  const handleUploadDocument = async (recordId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      alert('File is too large (10MB max)');
      e.target.value = '';
      return;
    }

    const token = localStorage.getItem('patientToken');
    const formData = new FormData();
    formData.append('recordId', recordId);
    formData.append('file', file);

    setUploadingRecordId(recordId);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patient-portal/documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error || 'Upload failed');
      await fetchMe();
    } catch (err: any) {
      alert(`Error uploading document: ${err.message}`);
    } finally {
      setUploadingRecordId(null);
      e.target.value = '';
    }
  };

  const handleDownloadDocument = async (docId: string, fileName: string) => {
    const token = localStorage.getItem('patientToken');
    setDownloadingDocId(docId);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patient-portal/documents/${docId}/download`, {
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
    } catch {
      alert('Error downloading document');
    } finally {
      setDownloadingDocId(null);
    }
  };

  const [printingRxId, setPrintingRxId] = useState<string | null>(null);

  const handlePrintPrescription = async (consultationId: string) => {
    setPrintingRxId(consultationId);
    try {
      await openDocumentPreview(`${process.env.NEXT_PUBLIC_API_URL}/patient-portal/consultations/${consultationId}/prescription/pdf`, localStorage.getItem('patientToken'));
    } catch (err: any) {
      alert(err.message);
    } finally {
      setPrintingRxId(null);
    }
  };

  const handleViewDocument = async (docId: string) => {
    try {
      await openDocumentPreview(`${process.env.NEXT_PUBLIC_API_URL}/patient-portal/documents/${docId}/download`, localStorage.getItem('patientToken'));
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    if (!confirm('Delete this document? This cannot be undone.')) return;
    const token = localStorage.getItem('patientToken');
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patient-portal/documents/${docId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error || 'Delete failed');
      await fetchMe();
    } catch (err: any) {
      alert(`Error deleting document: ${err.message}`);
    }
  };

  const handleRequestAppointment = async (recordId: string) => {
    if (!requestDate) {
      alert('Please choose a preferred date');
      return;
    }
    const token = localStorage.getItem('patientToken');
    setSubmittingRequest(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patient-portal/appointments/request`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId, preferredDate: requestDate, preferredTime: requestTime || undefined, reason: requestReason || undefined }),
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error || 'Request failed');
      setRequestFormFor(null);
      setRequestDate('');
      setRequestTime('');
      setRequestReason('');
      await fetchMe();
    } catch (err: any) {
      alert(`Error requesting appointment: ${err.message}`);
    } finally {
      setSubmittingRequest(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-slate-500 dark:text-slate-400">Loading your records...</div>;
  if (error) return <div className="p-8 text-center text-red-600">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <Card className="rounded-lg border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Patient ID</p>
        <p className="mt-1 font-mono text-lg font-semibold text-emerald-700 dark:text-emerald-500">{data.account.portableId}</p>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{data.account.email} - {data.account.phone}</p>
      </Card>

      {data.records.length === 0 && (
        <Card className="rounded-lg border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm text-slate-500 dark:text-slate-400">No facility has linked a record to your account yet.</p>
        </Card>
      )}

      {data.records.map((record) => (
        <Card key={record.id} className="rounded-lg border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <Building2 className="size-4 text-emerald-700" aria-hidden="true" />
            <h2 className="text-base font-semibold text-slate-950 dark:text-slate-50">{record.clinic.name}</h2>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                <CalendarClock className="size-4" aria-hidden="true" />
                Appointments
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRequestFormFor(requestFormFor === record.id ? null : record.id)}
              >
                <CalendarPlus className="size-4" aria-hidden="true" />
                Request appointment
              </Button>
            </div>

            {requestFormFor === record.id && (
              <div className="mt-3 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label htmlFor={`date-${record.id}`} className="text-xs">Preferred date</Label>
                    <Input id={`date-${record.id}`} type="date" value={requestDate} onChange={(e) => setRequestDate(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor={`time-${record.id}`} className="text-xs">Preferred time (optional)</Label>
                    <Input id={`time-${record.id}`} type="time" value={requestTime} onChange={(e) => setRequestTime(e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label htmlFor={`reason-${record.id}`} className="text-xs">Reason (optional)</Label>
                  <Input id={`reason-${record.id}`} value={requestReason} onChange={(e) => setRequestReason(e.target.value)} placeholder="Briefly describe why you'd like to be seen" />
                </div>
                <Button size="sm" disabled={submittingRequest} onClick={() => handleRequestAppointment(record.id)}>
                  {submittingRequest ? 'Submitting...' : 'Submit request'}
                </Button>
              </div>
            )}

            {record.appointmentRequests.filter((r) => r.status === 'PENDING').length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {record.appointmentRequests.filter((r) => r.status === 'PENDING').map((r) => (
                  <li key={r.id} className="rounded-md bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950/30">
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      Requested {new Date(r.preferredDate).toLocaleDateString()}{r.preferredTime ? ` at ${r.preferredTime}` : ''}
                    </span>
                    <span className={`ml-2 font-medium ${STATUS_STYLES[r.status]}`}>Awaiting confirmation</span>
                  </li>
                ))}
              </ul>
            )}

            {record.appointments.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400">No confirmed appointments yet</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {record.appointments.map((a) => (
                  <li key={a.id} className="rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800">
                    <span className="font-medium text-slate-800 dark:text-slate-200">{new Date(a.date).toLocaleDateString()} at {a.time}</span>
                    <span className="ml-2 text-slate-500 dark:text-slate-400">with Dr. {a.doctor.name} - {a.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-4">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              <AlertTriangle className="size-4" aria-hidden="true" />
              Allergies on record
            </div>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {record.allergyStatus === 'KNOWN' && record.allergies && record.allergies.length > 0
                ? record.allergies.map((a) => `${a.substance}${a.reaction ? ` (${a.reaction})` : ''}`).join('; ')
                : record.allergyStatus === 'NONE_KNOWN'
                ? 'No known allergies'
                : 'None recorded yet. Please tell your clinician about any allergies you have.'}
            </p>
          </div>

          <div className="mt-4">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              <Stethoscope className="size-4" aria-hidden="true" />
              Consultations
            </div>
            {record.consultations.length === 0 ? (
              <p className="mt-1 text-sm text-slate-400">None yet</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {record.consultations.map((c) => (
                  <li key={c.id} className="rounded-md bg-slate-50 px-3 py-3 text-sm dark:bg-slate-800/60">
                    <p className="mb-2 font-medium text-slate-800 dark:text-slate-200">Visit on {new Date(c.createdAt).toLocaleDateString()}</p>
                    <ConsultationDetails
                      consultation={c}
                      showNotes={false}
                      onPrintPrescription={() => handlePrintPrescription(c.id)}
                      printing={printingRxId === c.id}
                    />
                    {c.invoice && (
                      <p className="mt-1 text-slate-500 dark:text-slate-400">
                        Invoice: UGX {c.invoice.amount.toLocaleString()} - {c.invoice.status}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-4">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              <FlaskConical className="size-4" aria-hidden="true" />
              Lab tests
            </div>
            {record.labTests.length === 0 ? (
              <p className="mt-1 text-sm text-slate-400">None yet</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {record.labTests.map((t) => (
                  <li key={t.id} className="rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800">
                    <span className="font-medium text-slate-800 dark:text-slate-200">{t.testName}</span>
                    <span className="ml-2 text-slate-500 dark:text-slate-400">{t.status}{t.results ? ` - ${t.results}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                <Paperclip className="size-4" aria-hidden="true" />
                Documents
              </div>
              <input
                ref={(el) => { fileInputRefs.current[record.id] = el; }}
                type="file"
                onChange={(e) => handleUploadDocument(record.id, e)}
                disabled={uploadingRecordId === record.id}
                accept={DOCUMENT_ACCEPT}
                className="hidden"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={uploadingRecordId === record.id}
                onClick={() => fileInputRefs.current[record.id]?.click()}
              >
                <Upload className="size-4" aria-hidden="true" />
                {uploadingRecordId === record.id ? 'Uploading...' : 'Upload'}
              </Button>
            </div>
            <p className="mt-1 text-xs text-slate-400">{DOCUMENT_TYPES_HELP}</p>
            {record.documents.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400">No documents yet</p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {record.documents.map((d) => (
                  <DocumentItem
                    key={d.id}
                    fileName={d.fileName}
                    fileSize={d.fileSize}
                    format={d.format}
                    busy={downloadingDocId === d.id}
                    detail={`${DOCUMENT_CATEGORY_LABELS[d.category] || d.category} · ${new Date(d.createdAt).toLocaleDateString()}`}
                    onView={() => handleViewDocument(d.id)}
                    onDownload={() => handleDownloadDocument(d.id, d.fileName)}
                    onDelete={d.uploadedByPatientAccountId ? () => handleDeleteDocument(d.id) : undefined}
                  />
                ))}
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
