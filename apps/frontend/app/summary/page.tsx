'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileText, Printer } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { getCurrentClinicId, listLocalPatients, type LocalPatient } from '@/lib/local-first';
import { patientIdText } from '@/lib/patient-id';
import { openPdfWithAuth } from '@/lib/download';
import { shortDate, shortTime } from '@/lib/finance';

const API = process.env.NEXT_PUBLIC_API_URL;

type Lab = { name: string; status: string; result: string | null; verified: boolean; at: string };
type Summary = {
  patient: { name: string; patientId: string | null; sexAge: string | null; phone: string; allergies: string };
  visits: Array<{
    id: string; date: string; clinician: string | null; complaints: string; history: string | null; vitals: string | null; examination: string | null;
    diagnoses: string[]; labs: Lab[]; treatment: string[]; plan: string | null;
  }>;
  stays: Array<{
    id: string; ward: string; admittedAt: string; dischargedAt: string | null; reason: string; dischargeDiagnosis: string | null; dischargeSummary: string | null;
    procedures: Array<{ date: string; title: string; lines: Array<[string, string]> }>;
  }>;
  otherLabs: Lab[];
};

const LABEL = 'text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
      <dt className={LABEL}>{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words text-sm text-slate-800 dark:text-slate-200">{children}</dd>
    </div>
  );
}

function labText(l: Lab) {
  if (!l.result) return `${l.name}: ${l.status}`;
  return `${l.name}: ${l.result}${l.verified ? '' : ' (awaiting verification)'}`;
}

/**
 * One patient's clinical summary at the facility - each visit's complaints,
 * history, vital signs, examination, diagnosis, lab results and treatment, and
 * their ward stays with procedures and operations - to read before seeing the
 * patient again, or to print and hand on.
 */
function ClinicalSummaryPage() {
  const router = useRouter();
  const id = useSearchParams().get('id') ?? '';
  const [patients, setPatients] = useState<LocalPatient[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const clinicId = getCurrentClinicId();
    if (clinicId) listLocalPatients(clinicId).then(setPatients).catch(() => setPatients([]));
  }, []);

  useEffect(() => {
    setSummary(null);
    setError('');
    if (!id) return;
    setLoading(true);
    fetch(`${API}/patients/${id}/clinical-summary`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error || 'The summary could not be loaded');
        setSummary(data.summary);
      })
      .catch((e) => setError(navigator.onLine ? e.message : 'You are offline. The clinical summary needs an internet connection - it will load when it returns.'))
      .finally(() => setLoading(false));
  }, [id]);

  const print = () =>
    openPdfWithAuth(`${API}/patients/${id}/clinical-summary/pdf`, localStorage.getItem('token'), `clinical-summary-${summary?.patient.patientId ?? id.slice(0, 8)}.pdf`)
      .catch((e) => setError(e.message));

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8 dark:bg-slate-950">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-200">Clinical summary</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">A patient&apos;s history, examination findings, lab results and treatment at your facility, in one place.</p>
          </div>
          {summary && (
            <Button variant="outline" onClick={print}><Printer className="size-4" aria-hidden="true" /> Print / save PDF</Button>
          )}
        </div>

        <Card className="mb-6 p-5">
          <Label htmlFor="summary-patient">Patient</Label>
          <Select id="summary-patient" className="mt-2" value={id} onChange={(e) => router.replace(e.target.value ? `/summary?id=${e.target.value}` : '/summary')}>
            <option value="">Choose a patient</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{patientIdText(p.patientNumber) ? ` - ID ${patientIdText(p.patientNumber)}` : ''} - {p.phone}</option>
            ))}
          </Select>
        </Card>

        {loading && <p className="text-sm text-slate-500">Loading the summary...</p>}
        {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}

        {summary && (
          <div className="space-y-4">
            <Card className="p-5">
              <p className="text-xl font-semibold text-slate-900 dark:text-slate-50">{summary.patient.name}</p>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {[summary.patient.patientId ? `Patient ID ${summary.patient.patientId}` : null, summary.patient.sexAge, summary.patient.phone].filter(Boolean).join('  ·  ')}
              </p>
              <p className={`mt-2 text-sm font-medium ${summary.patient.allergies === 'No known allergies' ? 'text-slate-700 dark:text-slate-300' : 'text-rose-700 dark:text-rose-400'}`}>
                Allergies: {summary.patient.allergies}
              </p>
            </Card>

            {summary.visits.length === 0 && summary.stays.length === 0 && summary.otherLabs.length === 0 && (
              <Card className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">Nothing has been recorded for this patient at your facility yet.</Card>
            )}

            {summary.visits.map((v) => (
              <Card key={v.id} className="p-5">
                <h2 className="mb-3 flex flex-wrap items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                  <FileText className="size-4 text-emerald-700" aria-hidden="true" />
                  Visit - {shortDate(v.date)} {shortTime(v.date)}{v.clinician ? ` - ${v.clinician}` : ''}
                </h2>
                <dl className="space-y-2.5">
                  <Field label="Complaints">{v.complaints}</Field>
                  {v.history && <Field label="History">{v.history}</Field>}
                  {v.vitals && <Field label="Vital signs">{v.vitals}</Field>}
                  {v.examination && <Field label="Examination">{v.examination}</Field>}
                  {v.diagnoses.length > 0 && <Field label="Diagnosis">{v.diagnoses.join('\n')}</Field>}
                  {v.labs.length > 0 && <Field label="Lab tests">{v.labs.map(labText).join('\n')}</Field>}
                  {v.treatment.length > 0 && <Field label="Treatment">{v.treatment.map((t, i) => `${i + 1}. ${t}`).join('\n')}</Field>}
                  {v.plan && <Field label="Assessment and plan">{v.plan}</Field>}
                </dl>
              </Card>
            ))}

            {summary.stays.map((s) => (
              <Card key={s.id} className="p-5">
                <h2 className="mb-3 font-semibold text-slate-900 dark:text-slate-100">
                  Admission - {s.ward}, {shortDate(s.admittedAt)}{s.dischargedAt ? ` to ${shortDate(s.dischargedAt)}` : ' (still admitted)'}
                </h2>
                <dl className="space-y-2.5">
                  <Field label="Reason">{s.reason}</Field>
                  {s.procedures.map((p, i) => (
                    <Field key={i} label={shortDate(p.date)}>
                      <span className="font-medium">{p.title}</span>
                      {'\n'}{p.lines.filter(([label]) => !['Operation', 'Surgeon', 'Anaesthesia'].includes(label) && !(p.title.startsWith('Procedure') && label === 'Procedure')).map(([l, val]) => `${l}: ${val}`).join('\n')}
                    </Field>
                  ))}
                  {s.dischargeDiagnosis && <Field label="Final diagnosis">{s.dischargeDiagnosis}</Field>}
                  {s.dischargeSummary && <Field label="Discharge summary">{s.dischargeSummary}</Field>}
                </dl>
              </Card>
            ))}

            {summary.otherLabs.length > 0 && (
              <Card className="p-5">
                <h2 className="mb-3 font-semibold text-slate-900 dark:text-slate-100">Other lab tests</h2>
                <dl className="space-y-2.5">
                  {summary.otherLabs.map((l, i) => <Field key={i} label={shortDate(l.at)}>{labText(l)}</Field>)}
                </dl>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SummaryPage() {
  return (
    <Suspense fallback={<div className="p-8">Loading...</div>}>
      <ClinicalSummaryPage />
    </Suspense>
  );
}
