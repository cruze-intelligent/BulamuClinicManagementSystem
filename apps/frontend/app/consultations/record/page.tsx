'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { DiagnosisPicker } from '@/components/diagnosis-picker';
import { PrescriptionBuilder } from '@/components/prescription-builder';
import { AllergyPanel } from '@/components/allergy-panel';
import { findAllergyConflicts } from '@/lib/allergy';
import { useAuth } from '@/lib/useAuth';
import {
  createAppointmentOffline,
  createConsultationOffline,
  createLabTestOffline,
  createImagingRequestOffline,
  getLocalAppointment,
  listLocalAppointments,
  listLocalPatients,
  listLocalInventory,
  getCurrentClinicId,
  getCurrentUser,
  subscribeToLocalChanges,
  type LocalMedicine,
  type LocalPatient,
} from '@/lib/local-first';
import { Select } from '@/components/ui/select';
import { openVisitToday } from '@/lib/queue';
import { SuggestionInput } from '@/components/suggestion-input';
import { LAB_TESTS_CATALOG, findLabTest } from '@/lib/lab-tests-catalog';
import { VITAL_FIELDS, abnormalVitals } from '@/lib/wards';
import { diagnosesToPayload, diagnosisProblems, emptyDiagnosis, type DiagnosisDraft } from '@/lib/diagnosis';
import { draftProblems, draftToPayload, emptyDraft, isBlankDraft, type PrescriptionDraft } from '@/lib/prescription';
import { ageText } from '@/lib/age';
import { formatTime, serverNow } from '@/lib/time';
import { patientIdText } from '@/lib/patient-id';
import { MODALITIES, emptyImagingDraft, imagingDraftProblem, modalityLabel, type ImagingDraft, type Modality } from '@/lib/imaging';
import { activeDepartments, defaultDepartmentId, departmentName, knownDepartments, type Department } from '@/lib/departments';

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
  const { hasRole } = useAuth();
  const searchParams = useSearchParams();
  // From the waiting room or an appointment; otherwise an appointment is made
  // for this visit when it is saved, so the visit reaches the server.
  const appointmentId = searchParams.get('appointmentId') || '';
  const queryPatientId = searchParams.get('patientId') || '';

  const [patient, setPatient] = useState<LocalPatient | null>(null);
  const [stock, setStock] = useState<LocalMedicine[]>([]);
  const [symptoms, setSymptoms] = useState('');
  const [history, setHistory] = useState('');
  const [examination, setExamination] = useState('');
  const [vitals, setVitals] = useState<Record<string, string>>({});
  const [labText, setLabText] = useState('');
  const [labRequests, setLabRequests] = useState<string[]>([]);
  const [patients, setPatients] = useState<LocalPatient[]>([]);
  const [diagnoses, setDiagnoses] = useState<DiagnosisDraft[]>([emptyDiagnosis()]);
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [fee, setFee] = useState('');
  const [prescriptions, setPrescriptions] = useState<PrescriptionDraft[]>([emptyDraft()]);
  const [attempted, setAttempted] = useState(false);
  const [loading, setLoading] = useState(false);
  // The unit the visit is in (from the queue, or chosen for a walk-in), and one to send the patient on to.
  const [units, setUnits] = useState<Department[]>([]);
  const [visitUnit, setVisitUnit] = useState('');
  const [sendTo, setSendTo] = useState('');
  const [sendReason, setSendReason] = useState('');
  // Imaging requested at this visit (X-ray, scans...), and the one being written.
  const [imaging, setImaging] = useState<ImagingDraft[]>([]);
  const [imagingDraft, setImagingDraft] = useState<ImagingDraft>(emptyImagingDraft);
  const [imagingProblem, setImagingProblem] = useState('');

  useEffect(() => {
    const clinicId = getCurrentClinicId();
    if (!clinicId) return;
    const loadPatients = () => listLocalPatients(clinicId).then((list) => {
      setPatients(list);
      const found = queryPatientId ? list.find((p) => p.id === queryPatientId) : undefined;
      // Keep allergies just recorded on this page; take the patient from the device otherwise.
      if (found) setPatient((current) => (current?.id === found.id ? current : found));
    });
    void loadPatients();
    listLocalInventory(clinicId).then(setStock).catch(() => setStock([]));
    const active = activeDepartments(clinicId);
    setUnits(active);
    if (appointmentId) {
      getLocalAppointment(appointmentId).then((a) => setVisitUnit(a?.departmentId ?? '')).catch(() => undefined);
    } else {
      setVisitUnit(defaultDepartmentId(active));
    }
    // A patient who reaches this device after the page opened (a first sync) still appears.
    return subscribeToLocalChanges(() => { void loadPatients(); });
  }, [queryPatientId, appointmentId]);

  const diagnosisIssues = attempted ? diagnosisProblems(diagnoses) : [];
  // Whole shillings; a slip of the finger adding zeros is caught before saving.
  const feeProblem = fee && Number(fee) > 100_000_000 ? 'That fee looks too large - check the amount' : '';
  const conflictCount = (d: PrescriptionDraft) => findAllergyConflicts(patient, d.medication).length;
  const prescriptionIssues = prescriptions.some((d) => draftProblems(d, conflictCount(d)).length > 0);
  const vitalReadings = Object.fromEntries(Object.entries(vitals).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, Number(v)]));
  const vitalsProblem = VITAL_FIELDS.map((f) => {
    const v = vitalReadings[f.key];
    return v === undefined || (Number.isFinite(v) && v >= f.min && v <= f.max) ? null : `${f.label} must be between ${f.min} and ${f.max}`;
  }).find(Boolean) ?? '';
  const vitalFlags = abnormalVitals(vitalReadings);
  const addImaging = () => {
    const problem = imagingDraftProblem(imagingDraft);
    if (problem) return setImagingProblem(problem);
    setImaging((list) => [...list, { ...imagingDraft, examination: imagingDraft.examination.trim(), clinicalInfo: imagingDraft.clinicalInfo.trim() }]);
    setImagingDraft((d) => ({ ...emptyImagingDraft(), modality: d.modality }));
    setImagingProblem('');
  };
  const imagingExamples = MODALITIES.find((m) => m.value === imagingDraft.modality)?.examples ?? [];

  const addLabRequest = (name: string) => {
    const test = findLabTest(name)?.name ?? name.trim();
    if (test && !labRequests.some((t) => t.toLowerCase() === test.toLowerCase())) setLabRequests((list) => [...list, test]);
    setLabText('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttempted(true);

    // Everything is checked before anything is saved - a half-written
    // prescription must never reach a pharmacist.
    if (!patient || diagnosisProblems(diagnoses).length > 0 || prescriptions.some((d) => draftProblems(d, conflictCount(d)).length > 0) || feeProblem || vitalsProblem) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setLoading(true);
    try {
      const clinicId = getCurrentClinicId() || patient.clinicId;
      const user = getCurrentUser();
      // Recorded without its queue entry: the patient's open visit today is the
      // one being seen (so they leave the queue); with none, a walk-in seen now.
      let visitAppointmentId = appointmentId;
      if (!visitAppointmentId) {
        const open = openVisitToday(await listLocalAppointments(clinicId), patient.id, visitUnit || null);
        if (open) visitAppointmentId = open.id;
      }
      if (!visitAppointmentId) {
        const now = serverNow();
        const made = await createAppointmentOffline({
          patientId: patient.id, doctorId: user.id || '', clinicId, date: now.toISOString(),
          time: formatTime(now), notes: 'Walk-in',
          patientName: patient.name, doctorName: user.name, checkedInAt: now.toISOString(),
          departmentId: visitUnit || null,
        });
        visitAppointmentId = made.id;
      }
      const consultation = await createConsultationOffline({
        appointmentId: visitAppointmentId,
        patientId: patient.id,
        clinicId,
        history: history.trim(),
        examination: examination.trim(),
        vitals: Object.keys(vitalReadings).length ? vitalReadings : null,
        diagnoses: diagnosesToPayload(diagnoses),
        symptoms: symptoms.trim(),
        clinicalNotes: clinicalNotes.trim(),
        prescriptions: prescriptions.filter((d) => !isBlankDraft(d)).map(draftToPayload),
        fee: fee ? Number(fee) : undefined,
        patientName: patient.name,
      });
      // Tests requested at the visit go to the lab's worklist, linked to this visit.
      for (const testName of labRequests) {
        await createLabTestOffline({ patientId: patient.id, clinicId, testName, results: '', orderedBy: user.name || 'Clinician', patientName: patient.name, consultationId: consultation.id });
      }

      // Imaging goes to the imaging unit's worklist, linked to this visit.
      for (const r of imaging) {
        await createImagingRequestOffline({ patientId: patient.id, clinicId, consultationId: consultation.id, modality: r.modality, examination: r.examination, clinicalInfo: r.clinicalInfo, urgent: r.urgent });
      }

      // Sent on to another unit (OPD to Dentistry, say): they join its queue now.
      if (sendTo) {
        const now = serverNow();
        const from = departmentName(knownDepartments(clinicId), visitUnit);
        await createAppointmentOffline({
          patientId: patient.id, doctorId: user.id || '', clinicId, date: now.toISOString(), time: formatTime(now),
          notes: `Referred from ${from ?? 'another unit'} by ${user.name || 'a clinician'}${sendReason.trim() ? `: ${sendReason.trim()}` : ''}`,
          patientName: patient.name, doctorName: user.name, checkedInAt: now.toISOString(), departmentId: sendTo,
        });
      }

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
        patientIdText(patient.patientNumber) ? `ID ${patientIdText(patient.patientNumber)}` : null,
        patient.dateOfBirth ? ageText(patient.dateOfBirth, patient.dateOfBirthEstimated) : null,
      ].filter(Boolean).join('  |  ')
    : null;

  const summary = [
    attempted && diagnosisIssues.length > 0 ? 'the diagnosis' : null,
    attempted && prescriptionIssues ? 'the prescription details marked below' : null,
    attempted && feeProblem ? 'the fee' : null,
    attempted && vitalsProblem ? 'the vital signs' : null,
    attempted && !patient ? 'the patient' : null,
  ].filter(Boolean);

  return (
    <div className="min-h-screen p-8 bg-slate-50 dark:bg-slate-950">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold mb-1 text-slate-800 dark:text-slate-200">Record a visit</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          {patientLine ? `Patient: ${patientLine}` : 'Record a visit'}
        </p>

        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-8" noValidate>
            {summary.length > 0 && (
              <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                Nothing has been saved yet. Please complete {summary.join(' and ')}.
              </div>
            )}

            {units.length > 0 && (
              <section className="flex flex-wrap items-end gap-3">
                <div className="min-w-[12rem]">
                  <Label htmlFor="visit-unit">Unit</Label>
                  <Select id="visit-unit" className="mt-2" value={visitUnit} disabled={!!appointmentId} onChange={(e) => setVisitUnit(e.target.value)}>
                    <option value="">No unit given</option>
                    {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </Select>
                </div>
                {appointmentId && <p className="pb-2 text-xs text-slate-500 dark:text-slate-400">From the {departmentName(units, visitUnit) ?? ''} queue.</p>}
              </section>
            )}

            {!queryPatientId && (
              <section>
                <Label htmlFor="visit-patient">Patient</Label>
                <Select id="visit-patient" className="mt-2" value={patient?.id ?? ''} onChange={(e) => setPatient(patients.find((p) => p.id === e.target.value) ?? null)}>
                  <option value="">Choose the patient (register new patients first)</option>
                  {patients.map((p) => <option key={p.id} value={p.id}>{p.name} - {p.phone}</option>)}
                </Select>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Patients waiting are best seen from the waiting room on the Consultations page, in the order they arrived.</p>
              </section>
            )}

            {patient && (
              <AllergyPanel
                patientId={patient.id}
                clinicId={patient.clinicId}
                record={patient}
                canEdit={hasRole('NURSE', 'DOCTOR', 'PHARMACIST', 'ADMIN')}
                onSaved={(next) => setPatient((p) => (p ? { ...p, allergyStatus: next.allergyStatus, allergies: next.allergies } : p))}
              />
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
              <StepHeading n={2} title="History" hint="History of the presenting illness, and the relevant past medical and surgical, drug, family and social history." />
              <Label htmlFor="history" className="sr-only">History</Label>
              <Textarea id="history" rows={4} maxLength={6000} value={history} onChange={(e) => setHistory(e.target.value)}
                placeholder="e.g. Fever on and off for 3 days, worse at night, with chills. No cough or diarrhoea. No known chronic illness. Not on any medicines. Last menstrual period 2 weeks ago." />
            </section>

            <section>
              <StepHeading n={3} title="Vital signs" hint="Optional. Readings outside the usual range are flagged." />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {VITAL_FIELDS.map((f) => (
                  <div key={f.key}>
                    <Label htmlFor={`vital-${f.key}`} className="text-xs">{f.label}</Label>
                    <Input id={`vital-${f.key}`} type="number" inputMode="decimal" min={f.min} max={f.max} step={f.step} value={vitals[f.key] ?? ''}
                      onChange={(e) => setVitals((v) => ({ ...v, [f.key]: e.target.value }))} />
                  </div>
                ))}
              </div>
              {vitalFlags.length > 0 && !vitalsProblem && <p className="mt-2 text-sm font-medium text-rose-700 dark:text-rose-400">{vitalFlags.join(' · ')}</p>}
              {attempted && vitalsProblem && <p role="alert" className="mt-2 text-sm text-rose-700 dark:text-rose-400">{vitalsProblem}</p>}
            </section>

            <section>
              <StepHeading n={4} title="Examination" hint="General examination and the findings of each system examined." />
              <Label htmlFor="examination" className="sr-only">Examination findings</Label>
              <Textarea id="examination" rows={4} maxLength={6000} value={examination} onChange={(e) => setExamination(e.target.value)}
                placeholder="e.g. Febrile, mildly pale, not jaundiced, no oedema. Chest clear. Abdomen soft, no hepatosplenomegaly. CNS: alert, no neck stiffness." />
            </section>

            <section>
              <StepHeading n={5} title="Investigations" hint="Lab tests requested now go straight to the lab's worklist, linked to this visit." />
              <Label htmlFor="lab-request" className="sr-only">Request a lab test</Label>
              <SuggestionInput
                id="lab-request"
                value={labText}
                placeholder="Search or type a test: malaria RDT, CBC, urinalysis..."
                onChange={setLabText}
                suggestions={labText.trim().length < 2 ? [] : [
                  ...LAB_TESTS_CATALOG.filter((t) => `${t.name} ${t.aka ?? ''}`.toLowerCase().includes(labText.trim().toLowerCase())).slice(0, 8).map((t) => ({ key: t.name, label: t.name, detail: t.sample })),
                  ...(findLabTest(labText) ? [] : [{ key: `typed:${labText.trim()}`, label: `Request "${labText.trim()}"`, detail: 'Not in the list' }]),
                ]}
                onPick={(key) => addLabRequest(key.startsWith('typed:') ? key.slice(6) : key)}
              />
              {labRequests.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {labRequests.map((t) => (
                    <li key={t} className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                      {t}
                      <button type="button" className="text-emerald-700 hover:text-rose-700" aria-label={`Remove ${t}`} onClick={() => setLabRequests((list) => list.filter((x) => x !== t))}>×</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <StepHeading n={6} title="Imaging" hint="Optional. X-ray, ultrasound, CT and other scans - choose the kind, then write the examination. Requests go to the imaging unit's worklist, linked to this visit." />
              <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
                <div>
                  <Label htmlFor="imaging-modality">Kind of imaging</Label>
                  <Select id="imaging-modality" className="mt-1" value={imagingDraft.modality} onChange={(e) => setImagingDraft((d) => ({ ...d, modality: e.target.value as Modality }))}>
                    {MODALITIES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="imaging-examination">Examination</Label>
                  <SuggestionInput
                    id="imaging-examination"
                    value={imagingDraft.examination}
                    placeholder={imagingExamples.length ? `e.g. ${imagingExamples.slice(0, 2).join(', ')}` : 'Write the examination'}
                    onChange={(value) => setImagingDraft((d) => ({ ...d, examination: value }))}
                    suggestions={imagingExamples
                      .filter((x) => !imagingDraft.examination.trim() || x.toLowerCase().includes(imagingDraft.examination.trim().toLowerCase()))
                      .slice(0, 8)
                      .map((x) => ({ key: x, label: x }))}
                    onPick={(key) => setImagingDraft((d) => ({ ...d, examination: key }))}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="imaging-info">Clinical information <span className="font-normal text-slate-500">(optional)</span></Label>
                  <Input id="imaging-info" className="mt-1" maxLength={500} value={imagingDraft.clinicalInfo} placeholder="Why, and the question to answer - e.g. RUQ pain, ?gallstones" onChange={(e) => setImagingDraft((d) => ({ ...d, clinicalInfo: e.target.value }))} />
                </div>
                <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={imagingDraft.urgent} onChange={(e) => setImagingDraft((d) => ({ ...d, urgent: e.target.checked }))} /> Urgent
                  </label>
                  <Button type="button" size="sm" variant="outline" onClick={addImaging}>Add imaging request</Button>
                </div>
              </div>
              {imagingProblem && <p role="alert" className="mt-1 text-sm text-rose-700 dark:text-rose-300">{imagingProblem}</p>}
              {imaging.length > 0 && (
                <ul className="mt-3 space-y-1.5" aria-label="Imaging requested">
                  {imaging.map((r, i) => (
                    <li key={`${r.examination}-${i}`} className="flex items-start justify-between gap-2 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-950 dark:bg-sky-950/40 dark:text-sky-100">
                      <span>
                        <span className="font-medium">{r.examination}</span> <span className="text-xs">({modalityLabel(r.modality)}){r.urgent ? ' - urgent' : ''}</span>
                        {r.clinicalInfo && <span className="block text-xs opacity-80">{r.clinicalInfo}</span>}
                      </span>
                      <button type="button" className="text-sky-700 hover:text-rose-700" aria-label={`Remove ${r.examination}`} onClick={() => setImaging((list) => list.filter((_, j) => j !== i))}>×</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <StepHeading
                n={7}
                title="Diagnosis"
                hint="The first is the primary diagnosis. Search by name or ICD-10 code, and mark it Suspected if it is still a working diagnosis."
              />
              <DiagnosisPicker value={diagnoses} onChange={setDiagnoses} problems={diagnosisIssues} />
            </section>

            <section>
              <StepHeading n={8} title="Assessment and plan" hint="Optional: findings, reasoning, advice given and follow-up. Staff only - not shown to the patient." />
              <Label htmlFor="clinicalNotes" className="sr-only">Assessment and plan</Label>
              <Textarea
                id="clinicalNotes"
                value={clinicalNotes}
                onChange={(e) => setClinicalNotes(e.target.value)}
                maxLength={4000}
                placeholder="e.g. Uncomplicated malaria. Counselled on completing treatment. Review in 3 days if fever persists."
              />
            </section>

            <section>
              <StepHeading n={9} title="Prescription" hint="Leave empty if nothing is prescribed. The pharmacist is told when a prescription is waiting." />
              <PrescriptionBuilder value={prescriptions} onChange={setPrescriptions} stock={stock} showProblems={attempted} allergies={patient} />
            </section>

            <section>
              <StepHeading n={10} title="Consultation fee" hint="Optional. Opens the patient's bill under Bills & Payments, where lab tests, medicines and payments are added. Leave empty if there is no charge." />
              <Label htmlFor="fee" className="sr-only">Consultation fee in UGX</Label>
              <div className="flex max-w-xs items-center gap-2">
                <span className="text-sm text-slate-500 dark:text-slate-400">UGX</span>
                <Input
                  id="fee"
                  inputMode="numeric"
                  placeholder="e.g. 20000"
                  value={fee}
                  onChange={(e) => setFee(e.target.value.replace(/[^\d]/g, ''))}
                  aria-invalid={attempted && feeProblem ? true : undefined}
                />
              </div>
              {attempted && feeProblem && <p className="mt-1 text-sm text-rose-700 dark:text-rose-300">{feeProblem}</p>}
            </section>

            {units.length > 1 && (
              <section>
                <StepHeading n={11} title="Refer to another unit" hint="Optional. After this visit the patient joins that unit's waiting queue - from OPD to Dentistry, say - with your reason." />
                <Label htmlFor="send-to" className="sr-only">Send the patient to another unit</Label>
                <Select id="send-to" className="max-w-xs" value={sendTo} onChange={(e) => setSendTo(e.target.value)}>
                  <option value="">Not sent on - the visit ends here</option>
                  {units.filter((u) => u.id !== visitUnit).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </Select>
                {sendTo && (
                  <div className="mt-2 max-w-xl">
                    <Label htmlFor="send-reason">Reason for referral</Label>
                    <Input id="send-reason" className="mt-1" maxLength={200} value={sendReason} placeholder="e.g. Dental caries - for extraction" onChange={(e) => setSendReason(e.target.value)} />
                  </div>
                )}
              </section>
            )}

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
