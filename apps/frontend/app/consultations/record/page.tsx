'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { DiagnosisPicker } from '@/components/diagnosis-picker';
import { PrescriptionBuilder } from '@/components/prescription-builder';
import {
  createConsultationOffline,
  listLocalPatients,
  listLocalInventory,
  getCurrentClinicId,
  type LocalMedicine,
  type LocalPatient,
} from '@/lib/local-first';
import { diagnosesToPayload, diagnosisProblems, emptyDiagnosis, type DiagnosisDraft } from '@/lib/diagnosis';
import { draftProblems, draftToPayload, emptyDraft, isBlankDraft, type PrescriptionDraft } from '@/lib/prescription';
import { formatAge } from '@/lib/age';

function StepHeading({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-start gap-3">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-xs font-semibold text-white">{n}</span>
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        {hint && <p className="text-sm text-slate-500 dark:text-slate-400">{hint}</p>}
      </div>
    </div>
  );
}

function RecordConsultationForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const appointmentId = searchParams.get('appointmentId') || `apt-${Date.now()}`;
  const queryPatientId = searchParams.get('patientId') || '';

  const [patientId, setPatientId] = useState(queryPatientId);
  const [patient, setPatient] = useState<LocalPatient | null>(null);
  const [stock, setStock] = useState<LocalMedicine[]>([]);
  const [symptoms, setSymptoms] = useState('');
  const [diagnoses, setDiagnoses] = useState<DiagnosisDraft[]>([emptyDiagnosis()]);
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [prescriptions, setPrescriptions] = useState<PrescriptionDraft[]>([emptyDraft()]);
  const [attempted, setAttempted] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const clinicId = getCurrentClinicId();
    if (!clinicId) return;
    if (queryPatientId) {
      listLocalPatients(clinicId).then((patients) => {
        const found = patients.find((p) => p.id === queryPatientId);
        if (found) setPatient(found);
      });
    }
    listLocalInventory(clinicId).then(setStock).catch(() => setStock([]));
  }, [queryPatientId]);

  const diagnosisIssues = attempted ? diagnosisProblems(diagnoses) : [];
  const prescriptionIssues = prescriptions.some((d) => draftProblems(d).length > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttempted(true);

    // Everything is checked before anything is saved - a half-written
    // prescription must never reach a pharmacist.
    if (diagnosisProblems(diagnoses).length > 0 || prescriptions.some((d) => draftProblems(d).length > 0)) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setLoading(true);
    try {
      const clinicId = getCurrentClinicId() || 'default-clinic';
      await createConsultationOffline({
        appointmentId,
        patientId: patientId || 'walk-in-patient',
        clinicId,
        diagnoses: diagnosesToPayload(diagnoses),
        symptoms: symptoms.trim(),
        clinicalNotes: clinicalNotes.trim(),
        prescriptions: prescriptions.filter((d) => !isBlankDraft(d)).map(draftToPayload),
        patientName: patient?.name,
      });

      router.push('/consultations');
    } catch (error: any) {
      alert(`Error recording consultation: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const patientLine = patient
    ? [
        patient.name,
        patient.sex ? patient.sex.charAt(0) + patient.sex.slice(1).toLowerCase() : null,
        patient.dateOfBirth ? formatAge(patient.dateOfBirth) : null,
      ].filter(Boolean).join('  |  ')
    : null;

  const summary = [
    attempted && diagnosisIssues.length > 0 ? 'the diagnosis' : null,
    attempted && prescriptionIssues ? 'the prescription details marked below' : null,
  ].filter(Boolean);

  return (
    <div className="min-h-screen p-8 bg-slate-50 dark:bg-slate-950">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold mb-1 text-slate-800 dark:text-slate-200">Record Clinical Encounter</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          {patientLine ? `Patient: ${patientLine}` : 'Offline-first clinical record'}
        </p>

        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-8" noValidate>
            {summary.length > 0 && (
              <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                Nothing has been saved yet. Please complete {summary.join(' and ')}.
              </div>
            )}

            <section>
              <StepHeading n={1} title="Presenting complaints" hint="What the patient came in with, in their words and yours." />
              <Label htmlFor="symptoms" className="sr-only">Symptoms / presenting complaints</Label>
              <Textarea
                id="symptoms"
                value={symptoms}
                onChange={(e) => setSymptoms(e.target.value)}
                placeholder="e.g. Fever for 3 days, chills, headache, joint pain. No cough or diarrhoea."
                required
                aria-invalid={attempted && !symptoms.trim() ? true : undefined}
              />
              {attempted && !symptoms.trim() && <p role="alert" className="mt-1 text-sm text-rose-600">Please describe the presenting complaints.</p>}
            </section>

            <section>
              <StepHeading
                n={2}
                title="Diagnosis"
                hint="The first is the primary diagnosis. Search by name or ICD-10 code, and mark it Suspected if it is still a working diagnosis."
              />
              <DiagnosisPicker value={diagnoses} onChange={setDiagnoses} problems={diagnosisIssues} />
            </section>

            <section>
              <StepHeading n={3} title="Assessment and plan" hint="Optional: findings, reasoning, advice given and follow-up. Staff only - not shown to the patient." />
              <Label htmlFor="clinicalNotes" className="sr-only">Assessment and plan</Label>
              <Textarea
                id="clinicalNotes"
                value={clinicalNotes}
                onChange={(e) => setClinicalNotes(e.target.value)}
                maxLength={4000}
                placeholder="e.g. Temp 38.6, RDT positive. Counselled on completing treatment. Review in 3 days if fever persists."
              />
            </section>

            <section>
              <StepHeading n={4} title="Prescription" hint="Leave empty if nothing is prescribed. The pharmacist is told when a prescription is waiting." />
              <PrescriptionBuilder value={prescriptions} onChange={setPrescriptions} stock={stock} showProblems={attempted} />
            </section>

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Saving record...' : 'Save consultation (works offline)'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

export default function RecordConsultation() {
  return (
    <Suspense fallback={<div className="p-8">Loading consultation form...</div>}>
      <RecordConsultationForm />
    </Suspense>
  );
}
