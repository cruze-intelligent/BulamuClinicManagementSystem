'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Printer } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/useAuth';
import { openPdfWithAuth } from '@/lib/download';
import { facilityTypeLabel } from '@/lib/facility-types';
import {
  ANAESTHESIA_TYPES, DISCHARGE_OUTCOMES, KIND_LABEL, NOTE_KINDS, VITAL_FIELDS, abnormalVitals, structuredFields, structuredProblem, structuredTitle, vitalsText,
} from '@/lib/wards';
import { formatDayTime } from '@/lib/time';
import { DraftNote } from '@/components/draft-note';
import { useDraft } from '@/lib/drafts';
import { DiagnosisPicker } from '@/components/diagnosis-picker';
import { diagnosesToPayload, diagnosisProblems, diagnosisToDraft, emptyDiagnosis, type DiagnosisDraft, type DiagnosisView } from '@/lib/diagnosis';

const EMPTY_DISCHARGE = {
  outcome: 'RECOVERED', dischargeDiagnosis: '', dischargeIcd10Code: '', dischargeSummary: '', followUpInstructions: '',
  toClinicId: '', urgency: 'URGENT', consentConfirmed: false,
};
const EMPTY_MEDICATION = { medication: '', strength: '', dose: '', route: '', frequency: '', duration: '', instructions: '' };

const API = process.env.NEXT_PUBLIC_API_URL;
const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });
const when = (iso: string) => formatDayTime(iso);

export default function AdmissionPage() {
  return (
    <Suspense fallback={<div className="p-8">Loading...</div>}>
      <AdmissionChart />
    </Suspense>
  );
}

function AdmissionChart() {
  const id = useSearchParams().get('id') || '';
  const { user } = useAuth();
  const role = user?.role as string | undefined;
  const canDischarge = role === 'DOCTOR' || role === 'ADMIN';
  const canPrescribe = role === 'DOCTOR' || role === 'ADMIN';

  const [admission, setAdmission] = useState<any>(null);
  const [wards, setWards] = useState<any[]>([]);
  const [clinics, setClinics] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [note, setNote] = useState<{ kind: string; note: string; vitals: Record<string, string>; details: Record<string, string> }>({ kind: 'OBSERVATION', note: '', vitals: {}, details: {} });
  const [noteProblem, setNoteProblem] = useState('');
  const [panel, setPanel] = useState<'none' | 'transfer' | 'discharge'>('none');
  const [transfer, setTransfer] = useState({ wardId: '', bed: '', note: '' });
  const [discharge, setDischarge] = useState(EMPTY_DISCHARGE);
  const [busy, setBusy] = useState(false);
  // The working diagnosis, changed on a ward round.
  const [dxOpen, setDxOpen] = useState(false);
  const [dx, setDx] = useState<DiagnosisDraft[]>([emptyDiagnosis()]);
  const [dxTried, setDxTried] = useState(false);
  const [showMedication, setShowMedication] = useState(false);
  const [medication, setMedication] = useState(EMPTY_MEDICATION);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`${API}/admissions/${id}`, { headers: authHeaders() });
      const data = await res.json();
      if (!data.success) return setError(data.error || 'Admission not found');
      setError('');
      setAdmission(data.admission);
    } catch {
      setError(navigator.onLine ? 'Could not load this admission - please try again.' : 'You are offline. The ward chart needs an internet connection - it will load when it returns.');
    }
  }, [id]);

  useEffect(() => {
    load();
    fetch(`${API}/wards`, { headers: authHeaders() }).then((r) => r.json()).then((d) => d.success && setWards(d.wards.filter((w: any) => w.isActive))).catch(() => {});
    fetch(`${API}/clinics`, { headers: authHeaders() }).then((r) => r.json()).then((d) => d.success && setClinics(d.clinics.filter((c: any) => c.id !== user?.clinicId))).catch(() => {});
    window.addEventListener('online', load);
    return () => window.removeEventListener('online', load);
  }, [load, user?.clinicId]);

  const send = async (url: string, body: unknown) => {
    setBusy(true);
    try {
      const res = await fetch(`${API}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Something went wrong');
      await load();
      return true;
    } catch (e: any) {
      alert(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addNote = async (e: React.FormEvent) => {
    e.preventDefault();
    const fields = structuredFields(note.kind);
    if (fields) {
      const problem = structuredProblem(note.kind, note.details);
      setNoteProblem(problem ?? '');
      if (problem) return;
      const ok = await send(`/admissions/${id}/notes`, { kind: note.kind, details: note.details });
      if (ok) { noteDraft.discard(); setNote({ kind: note.kind, note: '', vitals: {}, details: {} }); }
      return;
    }
    const vitals = Object.fromEntries(Object.entries(note.vitals).filter(([, v]) => v !== ''));
    const ok = await send(`/admissions/${id}/notes`, { kind: note.kind, note: note.note || undefined, vitals: Object.keys(vitals).length ? vitals : undefined });
    if (ok) { noteDraft.discard(); setNote({ kind: note.kind, note: '', vitals: {}, details: {} }); }
  };

  const doTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await send(`/admissions/${id}/transfer`, { ...transfer, bed: transfer.bed || undefined })) setPanel('none');
  };

  /** The diagnoses on the chart now: the working ones, or what the patient was admitted with. */
  const currentDiagnoses = (): DiagnosisView[] =>
    Array.isArray(admission?.diagnoses) && admission.diagnoses.length
      ? admission.diagnoses
      : admission ? [{ description: admission.reason, icd10Code: admission.admissionIcd10Code ?? null, type: 'PRIMARY', certainty: 'PROVISIONAL' }] : [];

  const openDiagnosis = () => {
    setDx(currentDiagnoses().map(diagnosisToDraft));
    setDxTried(false);
    setDxOpen(true);
  };

  const saveDiagnosis = async () => {
    setDxTried(true);
    if (diagnosisProblems(dx).length) return;
    setBusy(true);
    try {
      const res = await fetch(`${API}/admissions/${id}/diagnoses`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ diagnoses: diagnosesToPayload(dx) }) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'The diagnosis could not be saved');
      setDxOpen(false);
      await load();
    } catch (e: any) {
      alert(navigator.onLine ? e.message : 'You are offline - the diagnosis is saved when the connection returns. Keep this page open.');
    } finally {
      setBusy(false);
    }
  };

  const addMedicationOrder = async (event: React.FormEvent) => {
    event.preventDefault();
    if (await send(`/admissions/${id}/medication-orders`, medication)) {
      setMedication(EMPTY_MEDICATION);
      setShowMedication(false);
    }
  };

  const stopMedicationOrder = async (order: any) => {
    const reason = window.prompt(`Stop ${order.medication}? Optional reason for the chart:`);
    if (reason === null) return;
    await send(`/admissions/${id}/medication-orders/${order.id}/stop`, { reason: reason || undefined });
  };

  const openDischarge = () => {
    // The final diagnosis starts from the working one; the clinician confirms or changes it.
    const primary = currentDiagnoses().find((d) => d.type === 'PRIMARY');
    if (primary) setDischarge((d) => (d.dischargeDiagnosis ? d : { ...d, dischargeDiagnosis: primary.description, dischargeIcd10Code: primary.icd10Code ?? '' }));
    setPanel(panel === 'discharge' ? 'none' : 'discharge');
  };

  const doDischarge = async (e: React.FormEvent) => {
    e.preventDefault();
    const referred = discharge.outcome === 'REFERRED';
    if (referred && !discharge.consentConfirmed) return alert('Confirm that the patient agreed to the referral and to their details being shared.');
    if (!confirm('Discharge this patient? The record cannot be edited afterwards.')) return;
    const ok = await send(`/admissions/${id}/discharge`, {
      outcome: discharge.outcome,
      dischargeDiagnosis: discharge.dischargeDiagnosis,
      dischargeIcd10Code: discharge.dischargeIcd10Code || undefined,
      dischargeSummary: discharge.dischargeSummary,
      followUpInstructions: discharge.followUpInstructions || undefined,
      referral: referred ? { toClinicId: discharge.toClinicId, urgency: discharge.urgency, consentConfirmed: discharge.consentConfirmed } : undefined,
    });
    if (ok) {
      dischargeDraft.discard();
      setPanel('none');
    }
  };

  // The discharge summary and a chart entry being written are kept as drafts on this device
  // as they are typed (lib/drafts): a refresh, a closed tab or a dropped connection loses nothing.
  const canDraft = !!admission && admission.status === 'ADMITTED';
  const dischargeDraft = useDraft({
    form: 'discharge',
    id: canDraft && canDischarge ? id : null,
    value: discharge,
    isEmpty: (v) => JSON.stringify(v) === JSON.stringify(EMPTY_DISCHARGE),
    label: `Discharge - ${admission?.patient?.name ?? 'patient'}`,
    path: `/wards/admission?id=${id}`,
    onRestore: (v) => { setDischarge(v); setPanel('discharge'); },
  });
  const noteDraft = useDraft({
    form: 'ward-note',
    id: canDraft ? id : null,
    value: note,
    isEmpty: (v) => !v.note.trim() && !Object.values(v.vitals).some(Boolean) && !Object.values(v.details).some((x) => String(x ?? '').trim()),
    label: `Ward chart entry - ${admission?.patient?.name ?? 'patient'}`,
    path: `/wards/admission?id=${id}`,
    onRestore: (v) => setNote(v),
  });

  if (error) return <div className="p-8"><p className="text-rose-700">{error}</p><Link href="/wards" className="text-sm underline">Back to wards</Link></div>;
  if (!admission) return <div className="p-8">Loading...</div>;

  const admitted = admission.status === 'ADMITTED';
  const noAllergies = admission.patient.allergies === 'No known allergies';

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8 dark:bg-slate-950">
      <div className="mx-auto max-w-4xl space-y-4">
        <Link href="/wards" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:underline dark:text-slate-400"><ArrowLeft className="size-4" aria-hidden="true" /> Wards</Link>

        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">
                <Link href={`/patients/view?id=${admission.patient.id}`} className="hover:underline">{admission.patient.name}</Link>
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {[admission.patient.sexAge, `${admission.ward.name}${admission.bed ? `, bed ${admission.bed}` : ''}`, `Day ${admission.daysAdmitted}`].filter(Boolean).join(' · ')}
              </p>
              <p className="mt-1 text-sm">Admitted {when(admission.admittedAt)} by {admission.admittedBy.name}{admission.attendingDoctor ? ` · attending: ${admission.attendingDoctor.name}` : ''}</p>
            </div>
            <span className={`rounded px-2 py-1 text-xs font-semibold ${admitted ? 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-300' : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>
              {admitted ? 'Admitted' : admission.outcomeLabel}
            </span>
          </div>
          <div className={`mt-3 flex items-start gap-2 rounded-md p-2 text-sm ${noAllergies ? 'bg-slate-100 dark:bg-slate-800' : 'bg-rose-50 font-medium text-rose-800 dark:bg-rose-950/40 dark:text-rose-300'}`}>
            {!noAllergies && <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
            <span>Allergies: {admission.patient.allergies}</span>
          </div>
          <p className="mt-3 text-sm"><span className="text-xs font-medium uppercase text-slate-500">Reason for admission</span><br />{admission.reason}{admission.admissionIcd10Code ? ` (${admission.admissionIcd10Code})` : ''}</p>

          <div className="mt-3 rounded-md border border-slate-200 p-3 dark:border-slate-800" data-testid="working-diagnosis">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium uppercase text-slate-500">{admitted ? 'Diagnosis' : 'Diagnosis during the stay'}</span>
              {admitted && canDischarge && !dxOpen && (
                <Button size="sm" variant="outline" onClick={openDiagnosis}>{Array.isArray(admission.diagnoses) && admission.diagnoses.length ? 'Update diagnosis' : 'Add diagnosis'}</Button>
              )}
            </div>
            {Array.isArray(admission.diagnoses) && admission.diagnoses.length ? (
              <ul className="mt-1 space-y-0.5 text-sm">
                {admission.diagnoses.map((d: DiagnosisView, i: number) => (
                  <li key={i}>
                    <span className={d.type === 'PRIMARY' ? 'font-semibold' : ''}>{d.type === 'PRIMARY' ? 'Primary: ' : 'Also: '}{d.description}</span>
                    {d.icd10Code ? <span className="ml-1 font-mono text-xs text-slate-500">{d.icd10Code}</span> : null}
                    {d.certainty === 'PROVISIONAL' ? <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200">Suspected</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">No diagnosis recorded on a ward round yet{admitted && canDischarge ? ' - add one as it is made, and update it as it changes.' : '.'}</p>
            )}
            {dxOpen && (
              <div className="mt-3 space-y-3">
                <DiagnosisPicker value={dx} onChange={setDx} problems={dxTried ? diagnosisProblems(dx) : []} />
                <p className="text-xs text-slate-500 dark:text-slate-400">Saved in the chart as a ward round entry, with your name and the time.</p>
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy} onClick={() => void saveDiagnosis()}>{busy ? 'Saving...' : 'Save diagnosis'}</Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setDxOpen(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>

          {admitted ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setPanel(panel === 'transfer' ? 'none' : 'transfer')}>Move ward / bed</Button>
              {canDischarge && <Button size="sm" onClick={openDischarge}>Discharge</Button>}
            </div>
          ) : (
            <div className="mt-4 space-y-2 rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800">
              <p><span className="font-medium">Discharged</span> {when(admission.dischargedAt)} by {admission.dischargedBy?.name ?? '-'}{admission.referral ? ` · referred to ${admission.referral.toClinic.name}` : ''}</p>
              <p><span className="font-medium">Final diagnosis:</span> {admission.dischargeDiagnosis}{admission.dischargeIcd10Code ? ` (${admission.dischargeIcd10Code})` : ''}</p>
              {admission.dischargeSummary && <p className="whitespace-pre-wrap"><span className="font-medium">Summary:</span> {admission.dischargeSummary}</p>}
              {admission.followUpInstructions && <p className="whitespace-pre-wrap"><span className="font-medium">Follow-up:</span> {admission.followUpInstructions}</p>}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => openPdfWithAuth(`${API}/admissions/${id}/discharge-summary`, localStorage.getItem('token'), `discharge-summary-${id.slice(0, 8)}.pdf`).catch((e) => alert(e.message))}>
                  <Printer className="size-4" aria-hidden="true" /> Discharge summary
                </Button>
                {admission.referral && (
                  <Button size="sm" variant="outline" onClick={() => openPdfWithAuth(`${API}/referrals/${admission.referral.id}/letter`, localStorage.getItem('token'), 'referral.pdf').catch((e) => alert(e.message))}>
                    <Printer className="size-4" aria-hidden="true" /> Referral letter
                  </Button>
                )}
              </div>
            </div>
          )}
        </Card>

        <Card className="p-5" data-testid="inpatient-medication-chart">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h2 className="font-semibold">Ward medication chart</h2><p className="text-xs text-slate-500 dark:text-slate-400">Orders are written and stopped by a doctor or facility admin. Nurses record each treatment in Nursing.</p></div>
            {admitted && canPrescribe && <Button size="sm" onClick={() => setShowMedication((open) => !open)}>{showMedication ? 'Cancel' : 'Add medication order'}</Button>}
          </div>
          {showMedication && admitted && canPrescribe && <form onSubmit={addMedicationOrder} className="mt-4 grid gap-3 rounded-lg border border-slate-200 p-4 sm:grid-cols-2 dark:border-slate-800">
            <div><Label htmlFor="med-order-name">Medicine</Label><Input id="med-order-name" required maxLength={120} value={medication.medication} onChange={(e) => setMedication((m) => ({ ...m, medication: e.target.value }))} placeholder="e.g. Ceftriaxone" /></div>
            <div><Label htmlFor="med-order-strength">Strength (optional)</Label><Input id="med-order-strength" value={medication.strength} onChange={(e) => setMedication((m) => ({ ...m, strength: e.target.value }))} placeholder="e.g. 1 g vial" /></div>
            <div><Label htmlFor="med-order-dose">Dose</Label><Input id="med-order-dose" required value={medication.dose} onChange={(e) => setMedication((m) => ({ ...m, dose: e.target.value }))} placeholder="e.g. 1 g" /></div>
            <div><Label htmlFor="med-order-route">Route (optional)</Label><Input id="med-order-route" value={medication.route} onChange={(e) => setMedication((m) => ({ ...m, route: e.target.value }))} placeholder="e.g. IV" /></div>
            <div><Label htmlFor="med-order-frequency">Frequency / times</Label><Input id="med-order-frequency" required value={medication.frequency} onChange={(e) => setMedication((m) => ({ ...m, frequency: e.target.value }))} placeholder="e.g. Every 8 hours" /></div>
            <div><Label htmlFor="med-order-duration">Duration (optional)</Label><Input id="med-order-duration" value={medication.duration} onChange={(e) => setMedication((m) => ({ ...m, duration: e.target.value }))} placeholder="e.g. 5 days" /></div>
            <div className="sm:col-span-2"><Label htmlFor="med-order-instructions">Instructions (optional)</Label><Textarea id="med-order-instructions" rows={2} value={medication.instructions} onChange={(e) => setMedication((m) => ({ ...m, instructions: e.target.value }))} placeholder="Additional instructions for nursing staff" /></div>
            <p className="sm:col-span-2 text-xs text-slate-500">A new order records the ward-round decision in the chart and alerts nursing staff. It does not dispense stock.</p>
            <Button type="submit" disabled={busy} className="sm:w-fit">{busy ? 'Saving…' : 'Save ward-round order'}</Button>
          </form>}
          <div className="mt-4 space-y-3">
            {(admission.medicationOrders ?? []).length === 0 ? <p className="text-sm text-slate-500">No medication orders recorded during this stay.</p> : admission.medicationOrders.map((order: any) => <article key={order.id} className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><h3 className="font-medium">{order.medication}{order.strength ? ` · ${order.strength}` : ''}</h3><p className="text-sm">{order.dose}{order.route ? ` · ${order.route}` : ''} · {order.frequency}{order.duration ? ` · ${order.duration}` : ''}</p>{order.instructions && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{order.instructions}</p>}<p className="mt-1 text-xs text-slate-500">Ordered {when(order.createdAt)} by {order.prescribedByName}</p></div>
                <span className={`rounded-full px-2 py-1 text-xs font-medium ${order.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>{order.status === 'ACTIVE' ? 'Active' : `Stopped ${order.stoppedAt ? when(order.stoppedAt) : ''}`}</span>
                {order.status === 'ACTIVE' && canPrescribe && admitted && <Button size="sm" variant="outline" disabled={busy} onClick={() => void stopMedicationOrder(order)}>Stop order</Button>}
              </div>
              {order.stopReason && <p className="mt-1 text-xs text-slate-500">Reason stopped: {order.stopReason}</p>}
              {order.administrations?.length > 0 && <ul className="mt-3 space-y-1 border-t border-slate-200 pt-2 text-xs dark:border-slate-800">{order.administrations.map((entry: any) => <li key={entry.id}>{when(entry.administeredAt)} · {entry.status.replace('_', ' ')}{entry.doseGiven ? ` · ${entry.doseGiven}` : ''}{entry.routeGiven ? ` ${entry.routeGiven}` : ''} · {entry.givenByName}{entry.note ? ` — ${entry.note}` : ''}</li>)}</ul>}
            </article>)}
          </div>
        </Card>

        {panel === 'transfer' && admitted && (
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Move to another ward or bed</h2>
            <form onSubmit={doTransfer} className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <Label htmlFor="t-ward">Ward</Label>
                <Select id="t-ward" required value={transfer.wardId} onChange={(e) => setTransfer((t) => ({ ...t, wardId: e.target.value }))}>
                  <option value="">Select ward</option>
                  {wards.map((w) => <option key={w.id} value={w.id} disabled={w.id !== admission.ward.id && w.occupied >= w.beds}>{w.name} ({w.beds - w.occupied} free)</option>)}
                </Select>
              </div>
              <div><Label htmlFor="t-bed">Bed</Label><Input id="t-bed" value={transfer.bed} onChange={(e) => setTransfer((t) => ({ ...t, bed: e.target.value }))} /></div>
              <div className="sm:col-span-3"><Label htmlFor="t-note">Reason (optional)</Label><Input id="t-note" value={transfer.note} onChange={(e) => setTransfer((t) => ({ ...t, note: e.target.value }))} placeholder="e.g. Needs closer monitoring" /></div>
              <Button type="submit" disabled={busy} className="sm:w-fit">Move patient</Button>
            </form>
          </Card>
        )}

        {panel === 'discharge' && admitted && canDischarge && (
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Discharge</h2>
            <form onSubmit={doDischarge} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="d-outcome">Outcome</Label>
                  <Select id="d-outcome" value={discharge.outcome} onChange={(e) => setDischarge((d) => ({ ...d, outcome: e.target.value }))}>
                    {DISCHARGE_OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </div>
                <div className="sm:col-span-2"><Label htmlFor="d-dx">Final diagnosis</Label><Input id="d-dx" required value={discharge.dischargeDiagnosis} onChange={(e) => setDischarge((d) => ({ ...d, dischargeDiagnosis: e.target.value }))} /></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div><Label htmlFor="d-icd">ICD-10 (optional)</Label><Input id="d-icd" value={discharge.dischargeIcd10Code} onChange={(e) => setDischarge((d) => ({ ...d, dischargeIcd10Code: e.target.value }))} /></div>
              </div>
              <div>
                <Label htmlFor="d-summary">Summary of the stay and treatment</Label>
                <Textarea id="d-summary" required={discharge.outcome !== 'ABSCONDED'} rows={4} value={discharge.dischargeSummary} onChange={(e) => setDischarge((d) => ({ ...d, dischargeSummary: e.target.value }))} placeholder="Course in hospital, treatment given, investigations and results, condition at discharge." />
              </div>
              <div>
                <Label htmlFor="d-follow">Follow-up and medicines to continue at home</Label>
                <Textarea id="d-follow" rows={3} value={discharge.followUpInstructions} onChange={(e) => setDischarge((d) => ({ ...d, followUpInstructions: e.target.value }))} placeholder="e.g. Complete Coartem (2 more days). Review at OPD in 1 week, sooner if fever returns." />
              </div>
              {discharge.outcome === 'REFERRED' && (
                <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <Label htmlFor="d-to">Refer to</Label>
                      <Select id="d-to" required value={discharge.toClinicId} onChange={(e) => setDischarge((d) => ({ ...d, toClinicId: e.target.value }))}>
                        <option value="">Select facility</option>
                        {clinics.map((c) => <option key={c.id} value={c.id}>{c.name} ({facilityTypeLabel(c.facilityType)})</option>)}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="d-urgency">Urgency</Label>
                      <Select id="d-urgency" value={discharge.urgency} onChange={(e) => setDischarge((d) => ({ ...d, urgency: e.target.value }))}>
                        <option value="ROUTINE">Routine</option><option value="URGENT">Urgent</option><option value="EMERGENCY">Emergency</option>
                      </Select>
                    </div>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400">The final diagnosis is the reason for referral and the summary goes with it, with the patient&apos;s allergies.</p>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1" checked={discharge.consentConfirmed} onChange={(e) => setDischarge((d) => ({ ...d, consentConfirmed: e.target.checked }))} />
                    <span>The patient (or their caregiver) agreed to the referral and to their details being shared with the receiving facility.</span>
                  </label>
                </div>
              )}
              <Button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Discharge patient'}</Button>
              <DraftNote savedAt={dischargeDraft.savedAt} restoredAt={dischargeDraft.restoredAt} onDiscard={() => { dischargeDraft.discard(); setDischarge(EMPTY_DISCHARGE); }} />
            </form>
          </Card>
        )}

        {admitted && (
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Add to the chart</h2>
            <form onSubmit={addNote} className="space-y-3">
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Entry type">
                {NOTE_KINDS.filter((k) => !('roles' in k) || (role && (k.roles as readonly string[]).includes(role))).map((k) => (
                  <button key={k.value} type="button" role="radio" aria-checked={note.kind === k.value} onClick={() => { setNoteProblem(''); setNote((n) => ({ ...n, kind: k.value, details: k.value === 'OPERATION_NOTE' && !n.details.surgeon && user?.name ? { surgeon: user.name } : n.details })); }}
                    className={`rounded-md border px-3 py-1.5 text-sm ${note.kind === k.value ? 'border-emerald-700 bg-emerald-50 font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200' : 'border-slate-300 dark:border-slate-700'}`}>
                    {k.label}
                  </button>
                ))}
              </div>
              {note.kind === 'OBSERVATION' && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {VITAL_FIELDS.map((f) => (
                    <div key={f.key}>
                      <Label htmlFor={`v-${f.key}`} className="text-xs">{f.label}</Label>
                      <Input id={`v-${f.key}`} type="number" inputMode="decimal" min={f.min} max={f.max} step={f.step} value={note.vitals[f.key] ?? ''}
                        onChange={(e) => setNote((n) => ({ ...n, vitals: { ...n.vitals, [f.key]: e.target.value } }))} />
                    </div>
                  ))}
                </div>
              )}
              {structuredFields(note.kind) ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {structuredFields(note.kind)!.map((f) => (
                    <div key={f.key} className={f.long ? 'sm:col-span-2' : ''}>
                      <Label htmlFor={`d-${f.key}`} className="text-xs">{f.label}{!f.required && <span className="font-normal text-slate-500"> (optional)</span>}</Label>
                      {note.kind === 'OPERATION_NOTE' && f.key === 'anaesthesia' ? (
                        <Select id={`d-${f.key}`} value={note.details[f.key] ?? ''} onChange={(e) => setNote((n) => ({ ...n, details: { ...n.details, [f.key]: e.target.value } }))}>
                          <option value="">Choose</option>
                          {ANAESTHESIA_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
                        </Select>
                      ) : f.long ? (
                        <Textarea id={`d-${f.key}`} rows={3} value={note.details[f.key] ?? ''} placeholder={f.placeholder} onChange={(e) => setNote((n) => ({ ...n, details: { ...n.details, [f.key]: e.target.value } }))} />
                      ) : (
                        <Input id={`d-${f.key}`} value={note.details[f.key] ?? ''} placeholder={f.placeholder} onChange={(e) => setNote((n) => ({ ...n, details: { ...n.details, [f.key]: e.target.value } }))} />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <Textarea rows={note.kind === 'OBSERVATION' ? 2 : 4} value={note.note} onChange={(e) => setNote((n) => ({ ...n, note: e.target.value }))}
                  placeholder={note.kind === 'WARD_ROUND' ? 'Assessment and plan' : note.kind === 'OBSERVATION' ? 'Comment (optional)' : 'Care given or intervention done, and how the patient is'} aria-label="Note" />
              )}
              {noteProblem && <p role="alert" className="text-sm text-rose-700 dark:text-rose-400">{noteProblem}</p>}
              <Button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save to chart'}</Button>
            </form>
          </Card>
        )}

        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Chart</h2>
          {admission.notes.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing recorded yet.</p>
          ) : (
            <ol className="space-y-3">
              {admission.notes.map((n: any) => {
                const flags = abnormalVitals(n.vitals);
                return (
                  <li key={n.id} className="border-l-2 border-slate-200 pl-3 dark:border-slate-700">
                    <p className="text-xs text-slate-500">{when(n.createdAt)} · {KIND_LABEL[n.kind] ?? n.kind} · {n.authorName}</p>
                    {n.vitals && <p className="text-sm font-medium">{vitalsText(n.vitals)}</p>}
                    {flags.length > 0 && <p className="text-xs font-semibold text-rose-700 dark:text-rose-400">{flags.join(' · ')}</p>}
                    {n.details && <p className="text-sm font-semibold">{structuredTitle(n.kind, n.details)}</p>}
                    {n.details && (
                      <dl className="mt-1 grid gap-x-3 gap-y-0.5 text-sm sm:grid-cols-[11rem_minmax(0,1fr)]">
                        {(structuredFields(n.kind) ?? []).filter((f) => n.details[f.key]).map((f) => (
                          <div key={f.key} className="contents">
                            <dt className="text-slate-500 dark:text-slate-400">{f.label}</dt>
                            <dd className="whitespace-pre-wrap break-words">{n.details[f.key]}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {n.note && <p className="whitespace-pre-wrap text-sm">{n.note}</p>}
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
