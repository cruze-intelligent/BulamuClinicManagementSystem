'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, FlaskConical, Pencil, Printer, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import {
  listLocalLabTests,
  createLabTestOffline,
  listLocalPatients,
  cacheLabTests,
  getCurrentClinicId,
  getCurrentUser,
  subscribeToLocalChanges,
  LocalLabTest,
  LocalPatient,
} from '@/lib/local-first';
import { useAuth } from '@/lib/useAuth';
import { roleLabel } from '@/lib/role-labels';
import { LAB_TESTS_CATALOG, LAB_TEST_GROUPS, findLabTest } from '@/lib/lab-tests-catalog';
import { formatDayTime } from '@/lib/time';
import { openPdfWithAuth } from '@/lib/download';
import { blankValues, labPanelFor, type LabValue } from '@/lib/lab-panels';
import { LabValuesForm, LabValuesTable } from '@/components/lab-values';
import { DraftNote } from '@/components/draft-note';
import { useDraft } from '@/lib/drafts';

const API = process.env.NEXT_PUBLIC_API_URL;

type Tab = 'todo' | 'review' | 'verified' | 'all';
const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'todo', label: 'To do' },
  { value: 'review', label: 'Awaiting verification' },
  { value: 'verified', label: 'Verified' },
  { value: 'all', label: 'All' },
];

const inTab = (test: LocalLabTest, tab: Tab) =>
  tab === 'all' ||
  (tab === 'todo' && test.status === 'PENDING') ||
  (tab === 'review' && test.status === 'COMPLETED' && !test.verifiedAt) ||
  (tab === 'verified' && !!test.verifiedAt);

const when = (iso?: string | null) => (iso ? formatDayTime(iso) : '');

async function call(path: string, method: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${localStorage.getItem('token')}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error || 'Something went wrong - please try again');
  return data;
}

export default function LabTestsPage() {
  const { hasRole, user } = useAuth();
  const [tests, setTests] = useState<LocalLabTest[]>([]);
  const [patients, setPatients] = useState<LocalPatient[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ patientId: '', testName: '', requestedBy: '' });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('todo');
  const [notice, setNotice] = useState('');

  // Entering results: the lab technician, nurses and clinicians. Verifying
  // (releasing to the patient): clinicians and the administrator.
  const canEnter = hasRole('LAB_TECH', 'NURSE', 'DOCTOR', 'ADMIN');
  // ...and a lab supervisor the administrator has given the right.
  const canVerify = hasRole('DOCTOR', 'ADMIN') || !!user?.canVerifyLab;
  // Tests are requested by clinicians - usually during the consultation - and by the lab itself for
  // people who come for tests alone; the lab works the list.
  const canOrder = hasRole('NURSE', 'DOCTOR', 'ADMIN', 'LAB_TECH');

  const loadData = async () => {
    const clinicId = getCurrentClinicId();
    if (clinicId) setPatients(await listLocalPatients(clinicId));
    setTests(await listLocalLabTests());
    setLoading(false);
  };

  // The server's list when the page opens and when the connection returns - not on every
  // change here: saving it is a change, and the page used to ask again without end.
  const refreshFromServer = async () => {
    const clinicId = getCurrentClinicId();
    if (!navigator.onLine || !clinicId) return;
    try {
      const res = await fetch(`${API}/lab/clinic/${clinicId}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      const data = await res.json();
      if (data.success && Array.isArray(data.tests)) await cacheLabTests(data.tests);
    } catch {
      // Offline or unreachable - the tests saved on this device are shown.
    }
  };

  useEffect(() => {
    loadData();
    void refreshFromServer();
    const unsubscribe = subscribeToLocalChanges(loadData);
    const online = () => void refreshFromServer();
    window.addEventListener('online', online);
    return () => { unsubscribe(); window.removeEventListener('online', online); };
  }, []);

  const orderTest = async (e: React.FormEvent) => {
    e.preventDefault();
    const user = getCurrentUser();
    const selectedPatient = patients.find((p) => p.id === formData.patientId);
    try {
      await createLabTestOffline({
        patientId: formData.patientId,
        clinicId: user.clinicId || 'default-clinic',
        testName: findLabTest(formData.testName)?.name ?? formData.testName.trim(),
        results: '',
        orderedBy: formData.requestedBy.trim() || user.name || 'Clinical Staff',
        patientName: selectedPatient?.name,
      });
      setShowForm(false);
      setFormData({ patientId: '', testName: '', requestedBy: '' });
      setNotice(`${formData.testName} ordered for ${selectedPatient?.name ?? 'the patient'}. The lab has been notified.`);
      loadData();
    } catch (error: any) {
      setNotice(`Could not order the test: ${error.message}`);
    }
  };

  // A server change to one test: keep the device copy in step.
  const replaced = async (test: LocalLabTest, message: string) => {
    await cacheLabTests([test]);
    setTests(await listLocalLabTests());
    setNotice(message);
  };

  const counts = Object.fromEntries(TABS.map((t) => [t.value, tests.filter((x) => inTab(x, t.value)).length])) as Record<Tab, number>;
  const shown = tests.filter((t) => inTab(t, tab));
  const catalogEntry = findLabTest(formData.testName);

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8 dark:bg-slate-950">
      <div className="mx-auto max-w-4xl">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-200">Lab tests</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              The lab's worklist: tests requested during consultations arrive here. Record each result; a clinician verifies it before the patient is told.
            </p>
          </div>
          {canOrder && <Button variant="outline" onClick={() => { setShowForm(!showForm); setFormData((f) => ({ ...f, requestedBy: f.requestedBy || user?.name || '' })); }}>{showForm ? 'Cancel' : '+ Request a test outside a visit'}</Button>}
        </div>

        {notice && (
          <p role="status" className="my-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">{notice}</p>
        )}

        {showForm && (
          <Card className="my-6 p-5">
            <form onSubmit={orderTest} className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="lab-patient">Patient</Label>
                <Select id="lab-patient" value={formData.patientId} onChange={(e) => setFormData({ ...formData, patientId: e.target.value })} required>
                  <option value="">Choose a patient</option>
                  {patients.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.phone})</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="testName">Test</Label>
                <Input id="testName" list="lab-tests" value={formData.testName} onChange={(e) => setFormData({ ...formData, testName: e.target.value })} placeholder="Start typing, e.g. Malaria RDT" required autoComplete="off" />
                <datalist id="lab-tests">
                  {LAB_TEST_GROUPS.flatMap((group) => LAB_TESTS_CATALOG.filter((t) => t.group === group).map((t) => <option key={t.name} value={t.name}>{group}</option>))}
                </datalist>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {catalogEntry ? `Sample: ${catalogEntry.sample}` : 'Choose from the list where you can - any other test can be typed.'}
                </p>
              </div>
              <div>
                <Label htmlFor="lab-requested-by">Requested by</Label>
                <Input id="lab-requested-by" value={formData.requestedBy} onChange={(e) => setFormData({ ...formData, requestedBy: e.target.value })} maxLength={80} placeholder="Name of the clinician asking" />
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Printed on the results. Change it when the test is asked for by someone else.</p>
              </div>
              <Button type="submit" className="sm:col-span-2">Order test (works offline)</Button>
            </form>
          </Card>
        )}

        <div className="my-4 flex flex-wrap gap-2" role="group" aria-label="Show tests">
          {TABS.map((t) => (
            <Button key={t.value} size="sm" variant={tab === t.value ? 'default' : 'outline'} aria-pressed={tab === t.value} onClick={() => setTab(t.value)}>
              {t.label} <span className="ml-1 rounded bg-black/10 px-1.5 text-xs dark:bg-white/10">{counts[t.value]}</span>
            </Button>
          ))}
        </div>

        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading lab tests...</p>
        ) : shown.length === 0 ? (
          <Card className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            {tests.length === 0 ? 'No lab tests yet. Order one above (works offline).' : 'Nothing here right now.'}
          </Card>
        ) : (
          <div className="space-y-3">
            {shown.map((test) => (
              <LabTestCard key={test.id} test={test} canEnter={canEnter} canVerify={canVerify} onChanged={replaced} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LabTestCard({
  test, canEnter, canVerify, onChanged,
}: {
  test: LocalLabTest;
  canEnter: boolean;
  canVerify: boolean;
  onChanged: (test: LocalLabTest, message: string) => void;
}) {
  const [mode, setMode] = useState<'view' | 'enter' | 'amend'>('view');
  const [results, setResults] = useState(test.results || '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Correcting who requested it (entered under the wrong name, or asked on someone's behalf).
  const [editingRequester, setEditingRequester] = useState(false);
  const [requester, setRequester] = useState(test.orderedBy);
  const hint = findLabTest(test.testName)?.resultHint;
  // A test with a result template (a blood count, kidney tests...) is entered value by value.
  const panel = labPanelFor(test.testName);
  const startValues = (): LabValue[] => (test.values?.length && panel
    ? blankValues(panel, test.patient?.sex).map((row) => ({ ...row, ...(test.values!.find((v) => v.name === row.name) ?? {}) }))
    : panel ? blankValues(panel, test.patient?.sex) : []);
  const [values, setValues] = useState<LabValue[]>(startValues);
  const [comment, setComment] = useState(test.comment ?? '');
  const byValue = !!panel;
  // A result being typed is kept as a draft on this device: a refresh brings it back, with its form open.
  type ResultDraft = { mode: 'view' | 'enter' | 'amend'; results: string; values: LabValue[]; comment: string; reason: string };
  const draft = useDraft<ResultDraft>({
    form: 'lab-result',
    id: canEnter ? test.id : null,
    value: { mode, results, values, comment, reason },
    isEmpty: (v) => v.mode === 'view' || (v.results === (test.results || '') && JSON.stringify(v.values) === JSON.stringify(startValues()) && v.comment === (test.comment ?? '') && !v.reason.trim()),
    label: `Lab result - ${test.testName}${test.patient?.name ? ` for ${test.patient.name}` : ''}`,
    path: '/lab',
    onRestore: (v) => { setMode(v.mode); setResults(v.results); setValues(v.values); setComment(v.comment); setReason(v.reason); },
  });
  const filled = values.filter((v) => v.value.trim());
  const verified = !!test.verifiedAt;
  const status = test.status === 'CANCELLED' ? 'Cancelled' : test.status === 'PENDING' ? 'Waiting for result' : verified ? 'Verified' : 'Awaiting verification';
  const statusStyle =
    test.status === 'CANCELLED' ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
      : test.status === 'PENDING' ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300'
        : verified ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
          : 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-300';

  const run = async (action: () => Promise<{ test: LocalLabTest }>, message: string) => {
    if (!navigator.onLine) {
      setError('You are offline - results are recorded when the connection returns.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { test: saved } = await action();
      draft.discard();
      onChanged({ ...test, ...saved, patient: test.patient ?? saved.patient }, message);
      setMode('view');
      setReason('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* At least 15rem wide: on a phone the actions drop below rather than squeezing the patient and test into a sliver. */}
        <div className="min-w-[15rem] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-slate-800 dark:text-slate-200">{test.patient?.name || 'Patient'}</h3>
            {test.syncStatus === 'pending' && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Not synced yet</span>}
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-sky-800 dark:text-sky-300"><FlaskConical className="size-4" aria-hidden="true" />{test.testName}</p>
          {editingRequester ? (
            <form
              className="mt-1 flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => call(`/lab/${test.id}/requester`, 'PATCH', { orderedBy: requester }), `${test.testName}: requested by ${requester.trim()}.`).then(() => setEditingRequester(false));
              }}
            >
              <Label htmlFor={`requester-${test.id}`} className="text-xs">Requested by</Label>
              <Input id={`requester-${test.id}`} className="h-8 w-full max-w-[14rem] text-sm" value={requester} onChange={(e) => setRequester(e.target.value)} maxLength={80} required autoFocus />
              <Button type="submit" size="sm" disabled={busy}>Save</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => { setEditingRequester(false); setRequester(test.orderedBy); }}>Cancel</Button>
            </form>
          ) : (
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Requested by {test.orderedBy} · {when(test.createdAt)}
              {canEnter && test.syncStatus !== 'pending' && (
                <button type="button" className="ml-2 font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400" onClick={() => setEditingRequester(true)}>Change</button>
              )}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          <span className={`rounded px-2.5 py-1 text-xs font-medium ${statusStyle}`}>{status}</span>
          {mode === 'view' && (
            <div className="flex flex-wrap justify-end gap-2">
              {test.status === 'PENDING' && canEnter && test.syncStatus !== 'pending' && (
                <>
                  <Button size="sm" onClick={() => setMode('enter')}><Pencil className="size-4" aria-hidden="true" />Enter result</Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => confirm(`Cancel the ${test.testName} for ${test.patient?.name ?? 'this patient'}?`) && run(() => call(`/lab/${test.id}`, 'PATCH', { status: 'CANCELLED' }), `${test.testName} cancelled.`)}>Cancel test</Button>
                </>
              )}
              {test.status === 'COMPLETED' && !verified && canVerify && (
                <Button size="sm" disabled={busy} onClick={() => run(() => call(`/lab/${test.id}/verify`, 'POST'), `${test.testName} verified - ${test.patient?.name ?? 'the patient'} has been told it is ready.`)}>
                  <CheckCircle2 className="size-4" aria-hidden="true" />Verify
                </Button>
              )}
              {test.status === 'COMPLETED' && !verified && canEnter && (
                <Button size="sm" variant="outline" onClick={() => setMode('enter')}>Correct</Button>
              )}
              {verified && canVerify && <Button size="sm" variant="outline" onClick={() => setMode('amend')}>Amend</Button>}
              {test.status === 'COMPLETED' && test.syncStatus !== 'pending' && (
                <Button
                  size="sm" variant="outline"
                  title="Prints this result with the patient's other results from the same day"
                  onClick={() => openPdfWithAuth(`${API}/lab/${test.id}/results/pdf`, localStorage.getItem('token'), `lab-results-${test.id.slice(0, 8)}.pdf`).catch((err) => setError(err.message))}
                >
                  <Printer className="size-4" aria-hidden="true" />Print results
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {test.results && mode === 'view' && (
        <div className="mt-2 rounded-md bg-slate-100 p-2.5 text-sm text-slate-800 dark:bg-slate-800 dark:text-slate-200">
          {test.values?.length ? <LabValuesTable values={test.values} comment={test.comment} /> : <p className="whitespace-pre-wrap"><strong className="font-medium">Result:</strong> {test.results}</p>}
          {test.resultedBy && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Entered by {test.resultedBy.name} ({roleLabel(test.resultedBy.role)}) · {when(test.resultedAt)}</p>}
          {test.verifiedBy && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
              <ShieldCheck className="size-3.5" aria-hidden="true" />Verified by {test.verifiedBy.name} ({roleLabel(test.verifiedBy.role)}) · {when(test.verifiedAt)}
            </p>
          )}
        </div>
      )}

      {(mode === 'enter' || mode === 'amend') && (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (byValue && filled.length === 0) {
              setError('Enter at least one value');
              return;
            }
            const result = byValue ? { values: filled, comment } : { results };
            if (mode === 'enter') {
              run(() => call(`/lab/${test.id}`, 'PATCH', { ...result, status: 'COMPLETED' }), `${test.testName} result recorded for ${test.patient?.name ?? 'the patient'}. A clinician will verify it.`);
            } else {
              run(() => call(`/lab/${test.id}/amend`, 'POST', { ...result, reason }), `${test.testName} result amended. It needs verifying again before the patient sees the change.`);
            }
          }}
        >
          {byValue ? (
            <>
              <p className="text-sm font-medium">{mode === 'amend' ? 'Corrected values' : 'Values'}</p>
              <LabValuesForm idPrefix={`value-${test.id}`} values={values} onChange={setValues} />
              <Label htmlFor={`comment-${test.id}`}>Comment <span className="font-normal text-slate-500">(optional)</span></Label>
              <Textarea id={`comment-${test.id}`} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="e.g. Microcytic picture - suggest iron studies" maxLength={1000} />
            </>
          ) : (
            <>
              <Label htmlFor={`result-${test.id}`}>{mode === 'amend' ? 'Corrected result' : 'Result'}</Label>
              <Textarea id={`result-${test.id}`} value={results} onChange={(e) => setResults(e.target.value)} placeholder={hint ?? 'Write the result as your lab reports it, with units'} maxLength={2000} required autoFocus />
            </>
          )}
          {mode === 'amend' && (
            <>
              <Label htmlFor={`reason-${test.id}`}>Why is it being amended?</Label>
              <Input id={`reason-${test.id}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Transcription error - wrong sample read" required maxLength={300} />
            </>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>{busy ? 'Saving...' : mode === 'amend' ? 'Save amendment' : 'Save result'}</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { draft.discard(); setMode('view'); setResults(test.results || ''); setValues(startValues()); setComment(test.comment ?? ''); setReason(''); setError(''); }}>Cancel</Button>
          </div>
          <DraftNote savedAt={draft.savedAt} restoredAt={draft.restoredAt} onDiscard={() => { draft.discard(); setMode('view'); setResults(test.results || ''); setValues(startValues()); setComment(test.comment ?? ''); setReason(''); }} />
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">{error}</p>}
    </Card>
  );
}
