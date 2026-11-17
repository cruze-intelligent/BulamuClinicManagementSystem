'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Plus, ScanLine } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { SuggestionInput } from '@/components/suggestion-input';
import { useAuth } from '@/lib/useAuth';
import { MODALITIES, emptyImagingDraft, imagingDraftProblem, modalityLabel, type ImagingDraft, type Modality } from '@/lib/imaging';
import { activeDepartments, myDepartmentIds, type Department } from '@/lib/departments';
import { formatDayTime } from '@/lib/time';
import { patientIdText } from '@/lib/patient-id';

const API = process.env.NEXT_PUBLIC_API_URL;

async function call(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${localStorage.getItem('token')}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error || 'Something went wrong - please try again');
  return data;
}

type ImagingRequest = {
  id: string; modality: Modality; examination: string; clinicalInfo: string | null; urgent: boolean; status: 'REQUESTED' | 'REPORTED' | 'CANCELLED';
  requestedBy: string; requestedAt: string; unit: { id: string; name: string } | null;
  findings: string | null; impression: string | null; reportedBy: string | null; reportedAt: string | null; cancelReason: string | null;
  patient: { id: string; name: string; patientId: string | null; sexAge: string | null };
};

const IMAGING_CODES = ['RADIOLOGY', 'ULTRASOUND'];

export default function ImagingPage() {
  return (
    <Suspense fallback={<div className="p-8">Loading...</div>}>
      <Imaging />
    </Suspense>
  );
}

/**
 * The imaging worklist: requests waiting (urgent first, then oldest first),
 * reported by the radiographer or sonographer, and the reports of the last 30
 * days. Clinicians also request imaging here, outside a visit.
 */
function Imaging() {
  const { user, hasRole } = useAuth();
  const clinicId = user?.clinicId as string | undefined;
  const canReport = hasRole('RADIOGRAPHER', 'DOCTOR', 'ADMIN');
  const canRequest = hasRole('DOCTOR', 'NURSE', 'ADMIN');
  const [status, setStatus] = useState<'REQUESTED' | 'REPORTED'>(useSearchParams().get('status') === 'REPORTED' ? 'REPORTED' : 'REQUESTED');
  const [units, setUnits] = useState<Department[]>([]);
  const [unitId, setUnitId] = useState('');
  const [requests, setRequests] = useState<ImagingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [showRequest, setShowRequest] = useState(false);

  useEffect(() => {
    const imagingUnits = activeDepartments(clinicId).filter((d) => d.code && IMAGING_CODES.includes(d.code));
    setUnits(imagingUnits);
    // Staff of an imaging unit see their own unit's list first.
    setUnitId(imagingUnits.find((u) => myDepartmentIds().includes(u.id))?.id ?? '');
  }, [clinicId]);

  const load = useCallback(async () => {
    try {
      const data = await call(`/imaging?status=${status}${unitId ? `&unitId=${unitId}` : ''}`);
      setRequests(data.requests);
      setLoadError('');
    } catch {
      setLoadError(navigator.onLine ? 'Could not load imaging requests - please try again.' : 'You are offline. Imaging requests load when the connection returns; requests made at a visit are sent then too.');
    } finally {
      setLoading(false);
    }
  }, [status, unitId]);

  useEffect(() => {
    void load();
    window.addEventListener('online', load);
    return () => window.removeEventListener('online', load);
  }, [load]);

  const done = (message: string) => {
    setNotice(message);
    void load();
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8 dark:bg-slate-950">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-bold"><ScanLine className="size-7 text-emerald-700" aria-hidden="true" /> Imaging</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">X-ray, ultrasound, CT and other imaging - requests waiting, and their reports.</p>
          </div>
          {canRequest && (
            <Button onClick={() => { setShowRequest((v) => !v); setNotice(''); }}><Plus className="size-4" aria-hidden="true" /> {showRequest ? 'Cancel' : 'Request imaging'}</Button>
          )}
        </div>

        {showRequest && clinicId && <RequestForm clinicId={clinicId} onDone={(m) => { setShowRequest(false); done(m); }} />}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900" role="tablist" aria-label="Show">
            {(['REQUESTED', 'REPORTED'] as const).map((s) => (
              <button key={s} type="button" role="tab" aria-selected={status === s} onClick={() => { setLoading(true); setStatus(s); }}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${status === s ? 'bg-emerald-700 text-white' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'}`}>
                {s === 'REQUESTED' ? 'Waiting' : 'Reported (last 30 days)'}
              </button>
            ))}
          </div>
          {units.length > 1 && (
            <Select aria-label="Imaging unit" className="w-auto" value={unitId} onChange={(e) => { setLoading(true); setUnitId(e.target.value); }}>
              <option value="">All imaging units</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          )}
        </div>

        {notice && <p role="status" className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">{notice}</p>}
        {loadError && <p role="status" className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{loadError}</p>}

        {loading ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : requests.length === 0 ? (
          <Card className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            {status === 'REQUESTED' ? 'No imaging waiting. Requests made at a visit or here appear in this list.' : 'No reports in the last 30 days.'}
          </Card>
        ) : (
          <div className="space-y-3">
            {requests.map((r) => <RequestCard key={r.id} request={r} canReport={canReport} onDone={done} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function RequestCard({ request: r, canReport, onDone }: { request: ImagingRequest; canReport: boolean; onDone: (message: string) => void }) {
  const [panel, setPanel] = useState<'report' | 'cancel' | null>(null);
  const [findings, setFindings] = useState(r.findings ?? '');
  const [impression, setImpression] = useState(r.impression ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (work: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError('');
    try {
      await work();
      setPanel(null);
      onDone(message);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={`p-4 ${r.urgent && r.status === 'REQUESTED' ? 'border-rose-300 dark:border-rose-900' : ''}`} data-testid="imaging-request">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900 dark:text-slate-100">
            {r.examination}
            <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-900 dark:bg-sky-950 dark:text-sky-200">{modalityLabel(r.modality)}</span>
            {r.urgent && <span className="ml-1 rounded bg-rose-100 px-1.5 py-0.5 text-xs font-semibold text-rose-800 dark:bg-rose-950 dark:text-rose-300">Urgent</span>}
          </p>
          <p className="text-sm text-slate-700 dark:text-slate-300">
            {r.patient.name}
            {r.patient.patientId && <span className="ml-2 font-mono text-xs text-slate-500">ID {r.patient.patientId}</span>}
            {r.patient.sexAge && <span className="ml-2 text-xs text-slate-500">{r.patient.sexAge}</span>}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Requested by {r.requestedBy}, {formatDayTime(r.requestedAt)}{r.unit ? ` - ${r.unit.name}` : ''}
          </p>
          {r.clinicalInfo && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300"><span className="font-medium">Clinical information:</span> {r.clinicalInfo}</p>}
        </div>
        {r.status === 'REQUESTED' && (
          <div className="flex flex-wrap gap-2">
            {canReport && <Button size="sm" onClick={() => setPanel(panel === 'report' ? null : 'report')}>Write report</Button>}
            <Button size="sm" variant="outline" onClick={() => setPanel(panel === 'cancel' ? null : 'cancel')}>Cancel request</Button>
          </div>
        )}
        {r.status === 'REPORTED' && canReport && <Button size="sm" variant="outline" onClick={() => setPanel(panel === 'report' ? null : 'report')}>Correct report</Button>}
      </div>

      {r.status === 'REPORTED' && panel !== 'report' && (
        <div className="mt-3 rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800">
          <p className="whitespace-pre-line"><span className="font-semibold">Findings:</span> {r.findings}</p>
          <p className="mt-2 whitespace-pre-line"><span className="font-semibold">Impression:</span> {r.impression}</p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Reported by {r.reportedBy}{r.reportedAt ? `, ${formatDayTime(r.reportedAt)}` : ''}</p>
        </div>
      )}

      {panel === 'report' && (
        <form
          className="mt-3 space-y-3 rounded-md border border-slate-200 p-3 dark:border-slate-800"
          aria-label={`Report for ${r.examination}`}
          onSubmit={(e) => { e.preventDefault(); void run(() => call(`/imaging/${r.id}/report`, 'PATCH', { findings, impression }), `The ${r.examination} report for ${r.patient.name} was saved${r.status === 'REQUESTED' ? ' and the requester told' : ''}.`); }}
        >
          <div>
            <Label htmlFor={`findings-${r.id}`}>Findings</Label>
            <Textarea id={`findings-${r.id}`} className="mt-1" rows={5} maxLength={5000} value={findings} onChange={(e) => setFindings(e.target.value)} placeholder="What was seen, organ by organ" />
          </div>
          <div>
            <Label htmlFor={`impression-${r.id}`}>Impression</Label>
            <Textarea id={`impression-${r.id}`} className="mt-1" rows={2} maxLength={1000} value={impression} onChange={(e) => setImpression(e.target.value)} placeholder="The conclusion the requester acts on, e.g. Cholelithiasis without cholecystitis" />
          </div>
          {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>{busy ? 'Saving...' : 'Save report'}</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setPanel(null)}>Close</Button>
          </div>
        </form>
      )}

      {panel === 'cancel' && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30"
          onSubmit={(e) => { e.preventDefault(); void run(() => call(`/imaging/${r.id}/cancel`, 'POST', { reason }), `The ${r.examination} request was cancelled.`); }}
        >
          <div className="min-w-[14rem] flex-1">
            <Label htmlFor={`cancel-${r.id}`}>Why is it cancelled?</Label>
            <Input id={`cancel-${r.id}`} className="mt-1" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Requested in error, patient referred" />
          </div>
          <Button type="submit" size="sm" variant="destructive" disabled={busy || !reason.trim()}>Cancel request</Button>
          {error && <p role="alert" className="w-full text-sm text-rose-700">{error}</p>}
        </form>
      )}
    </Card>
  );
}

function RequestForm({ clinicId, onDone }: { clinicId: string; onDone: (message: string) => void }) {
  const [patients, setPatients] = useState<Array<{ id: string; name: string; phone: string; patientNumber?: number | null }>>([]);
  const [patientId, setPatientId] = useState('');
  const [draft, setDraft] = useState<ImagingDraft>(emptyImagingDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const examples = MODALITIES.find((m) => m.value === draft.modality)?.examples ?? [];

  useEffect(() => {
    call(`/patients/${clinicId}`).then((d) => setPatients(d.patients ?? [])).catch(() => setPatients([]));
  }, [clinicId]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!patientId) return setError('Choose the patient');
    const problem = imagingDraftProblem(draft);
    if (problem) return setError(problem);
    setBusy(true);
    setError('');
    try {
      await call('/imaging', 'POST', { patientId, ...draft });
      onDone(`${draft.examination.trim()} was requested and sent to the imaging worklist.`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-6 p-5">
      <h2 className="text-lg font-semibold">Request imaging</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">For imaging outside a visit. At a visit, request it on the visit form.</p>
      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="imaging-patient">Patient</Label>
          <Select id="imaging-patient" className="mt-1" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
            <option value="">Choose the patient</option>
            {patients.map((p) => <option key={p.id} value={p.id}>{p.name}{patientIdText(p.patientNumber) ? ` - ID ${patientIdText(p.patientNumber)}` : ''} - {p.phone}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="request-modality">Kind of imaging</Label>
          <Select id="request-modality" className="mt-1" value={draft.modality} onChange={(e) => setDraft((d) => ({ ...d, modality: e.target.value as Modality }))}>
            {MODALITIES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="request-examination">Examination</Label>
          <SuggestionInput
            id="request-examination"
            value={draft.examination}
            placeholder={examples.length ? `e.g. ${examples[0]}` : 'Write the examination'}
            onChange={(value) => setDraft((d) => ({ ...d, examination: value }))}
            suggestions={examples.filter((x) => !draft.examination.trim() || x.toLowerCase().includes(draft.examination.trim().toLowerCase())).slice(0, 8).map((x) => ({ key: x, label: x }))}
            onPick={(key) => setDraft((d) => ({ ...d, examination: key }))}
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="request-info">Clinical information <span className="font-normal text-slate-500">(optional)</span></Label>
          <Input id="request-info" className="mt-1" maxLength={500} value={draft.clinicalInfo} onChange={(e) => setDraft((d) => ({ ...d, clinicalInfo: e.target.value }))} placeholder="Why, and the question to answer" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.urgent} onChange={(e) => setDraft((d) => ({ ...d, urgent: e.target.checked }))} /> Urgent
        </label>
        {error && <p role="alert" className="text-sm text-rose-700 sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy}>{busy ? 'Sending...' : 'Send request'}</Button>
        </div>
      </form>
    </Card>
  );
}
