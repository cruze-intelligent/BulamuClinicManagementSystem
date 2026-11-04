'use client';

import { useEffect, useState } from 'react';
import { Building2, Clock, History, Loader2, Pencil } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FACILITY_TYPES, facilityTypeLabel } from '@/lib/facility-types';
import { shortDate } from '@/lib/finance';
import {
  DETAIL_LABELS, STATUS_LABELS, allowanceText, changeRows, detailEdits, detailProblem, formFrom,
  type Allowance, type DetailChange, type DetailField, type DetailForm, type FacilityDetails,
} from '@/lib/facility-details';

const API = process.env.NEXT_PUBLIC_API_URL;

type Loaded = {
  facility: FacilityDetails & { id: string; facilityCode: string };
  allowance?: Allowance;
  pending?: DetailChange | null;
  history?: DetailChange[];
};

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || 'That did not work - please try again.');
  return data;
}

/** The signed-in user's saved copy of their facility, so the rest of the app shows the new name at once. */
function rememberFacility(details: FacilityDetails) {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.clinic) localStorage.setItem('user', JSON.stringify({ ...user, clinic: { ...user.clinic, ...details } }));
  } catch {
    // The page still shows the new details; the copy refreshes at next sign-in.
  }
}

function ChangeTable({ change }: { change: Pick<DetailChange, 'changes'> }) {
  return (
    <dl className="mt-2 grid gap-1 text-sm">
      {changeRows(change).map(([label, from, to]) => (
        <div key={label} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
          <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
          <dd className="min-w-0 break-words">
            <span className="text-slate-500 line-through dark:text-slate-400">{from}</span>{' '}
            <span aria-hidden="true">&rarr;</span><span className="sr-only">changes to</span>{' '}
            <span className="font-medium text-slate-950 dark:text-slate-50">{to}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The facility's details as its documents print them. The administrator edits
 * them here: a few changes a year are made at once, after that Bulamu checks
 * each one first.
 */
export function FacilityDetailsEditor({ clinicId, isAdmin, onChanged }: { clinicId: string; isAdmin: boolean; onChanged?: (details: FacilityDetails) => void }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<DetailForm | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [message, setMessage] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  const load = async () => {
    try {
      const loaded: Loaded = await call(`/clinics/${clinicId}/details`);
      setData(loaded);
      setLoadError('');
      return loaded;
    } catch (error: any) {
      setLoadError(error.message);
      return null;
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId]);

  const startEditing = () => {
    if (!data) return;
    setForm(formFrom(data.facility));
    setNote('');
    setProblem('');
    setMessage('');
    setEditing(true);
  };

  const needsReview = data?.allowance?.remaining === 0;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!data || !form) return;
    const wrong = detailProblem(form);
    if (wrong) return setProblem(wrong);
    const edits = detailEdits(form, data.facility);
    if (Object.keys(edits).length === 0) return setProblem('Nothing has changed yet');
    if (needsReview && !note.trim()) return setProblem('Say why the details are changing - Bulamu reads this when checking the change');
    setBusy(true);
    setProblem('');
    try {
      const saved = await call(`/clinics/${clinicId}/details`, { method: 'PATCH', body: JSON.stringify({ ...edits, ...(note.trim() ? { note: note.trim() } : {}) }) });
      setEditing(false);
      setMessage(saved.message);
      if (saved.outcome === 'APPLIED') {
        rememberFacility(saved.facility);
        onChanged?.(saved.facility);
      }
      await load();
    } catch (error: any) {
      setProblem(navigator.onLine ? error.message : 'You are offline - the details can be changed once the connection returns.');
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!confirm('Withdraw this change? Bulamu will not review it, and the details stay as they are.')) return;
    setBusy(true);
    try {
      await call(`/clinics/${clinicId}/details/pending`, { method: 'DELETE' });
      setMessage('Change withdrawn. The details are as they were.');
      await load();
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const facility = data?.facility;
  const set = (field: DetailField) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => (f ? { ...f, [field]: event.target.value } : f));
  const location = facility ? [facility.parish, facility.subCounty, facility.district].filter(Boolean).join(', ') : '';

  return (
    <Card className="mt-6 p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-emerald-700 text-white">
          <Building2 className="size-5" aria-hidden="true" />
        </div>
        {/* Wide enough to read on a phone: the Edit button wraps below instead of squeezing it. */}
        <div className="min-w-[13rem] flex-1 text-sm">
          {!data && !loadError && <p className="text-slate-500 dark:text-slate-400">Loading the facility details...</p>}
          {loadError && <p role="alert" className="text-red-700 dark:text-red-400">{loadError}</p>}
          {facility && (
            <>
              <p className="break-words text-lg font-semibold text-slate-950 dark:text-slate-50">{facility.name}</p>
              <p className="text-slate-600 dark:text-slate-400">Facility ID {facility.facilityCode} &middot; {facilityTypeLabel(facility.facilityType ?? '')}</p>
              <p className="break-words text-slate-600 dark:text-slate-400">{facility.phone}</p>
              <p className="break-words text-slate-600 dark:text-slate-400">{facility.address}</p>
              {location && <p className="break-words text-slate-600 dark:text-slate-400">{location}</p>}
            </>
          )}
        </div>
        {isAdmin && facility && !editing && (
          <Button type="button" variant="outline" size="sm" onClick={startEditing} disabled={!!data?.pending || busy}>
            <Pencil className="size-4" aria-hidden="true" /> Edit details
          </Button>
        )}
      </div>

      {!isAdmin && facility && <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Your facility administrator can change these details.</p>}

      {message && <p role="status" className="mt-4 text-sm text-emerald-700 dark:text-emerald-400">{message}</p>}

      {data?.pending && (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
            <Clock className="size-4" aria-hidden="true" /> Waiting for Bulamu to check this change
          </p>
          <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/80">
            Sent on {shortDate(data.pending.createdAt)}. The details above stay as they are until it is approved; you will get an email either way.
          </p>
          <ChangeTable change={data.pending} />
          {data.pending.note && <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">Why: {data.pending.note}</p>}
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={withdraw} disabled={busy}>Withdraw the change</Button>
        </div>
      )}

      {editing && form && (
        <form onSubmit={save} className="mt-5 grid gap-4 border-t border-slate-200 pt-5 sm:grid-cols-2 dark:border-slate-800" noValidate>
          <div className="sm:col-span-2">
            <Label htmlFor="facility-name">{DETAIL_LABELS.name}</Label>
            <Input id="facility-name" value={form.name} onChange={set('name')} maxLength={120} />
          </div>
          <div>
            <Label htmlFor="facility-type">{DETAIL_LABELS.facilityType}</Label>
            <Select id="facility-type" value={form.facilityType} onChange={set('facilityType')}>
              {FACILITY_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="facility-phone">{DETAIL_LABELS.phone}</Label>
            <Input id="facility-phone" type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} maxLength={30} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="facility-address">{DETAIL_LABELS.address}</Label>
            <Input id="facility-address" value={form.address} onChange={set('address')} maxLength={300} />
          </div>
          {(['district', 'subCounty', 'parish'] as const).map((field) => (
            <div key={field}>
              <Label htmlFor={`facility-${field}`}>{DETAIL_LABELS[field]} <span className="font-normal text-slate-500">(optional)</span></Label>
              <Input id={`facility-${field}`} value={form[field]} onChange={set(field)} maxLength={80} />
            </div>
          ))}
          {data?.allowance && (
            <p className={`text-sm sm:col-span-2 ${needsReview ? 'text-amber-800 dark:text-amber-300' : 'text-slate-600 dark:text-slate-400'}`}>{allowanceText(data.allowance)}</p>
          )}
          {needsReview && (
            <div className="sm:col-span-2">
              <Label htmlFor="facility-note">Why the details are changing</Label>
              <Textarea id="facility-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="For example: we moved to a new building on Plot 9, or the ministry upgraded us to a Health Centre III." />
            </div>
          )}
          {problem && <p role="alert" className="text-sm text-red-700 sm:col-span-2 dark:text-red-400">{problem}</p>}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {needsReview ? 'Send to Bulamu for review' : 'Save the details'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
          </div>
        </form>
      )}

      {isAdmin && !editing && data?.allowance && !data.pending && (
        <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">{allowanceText(data.allowance, false)}</p>
      )}

      {isAdmin && !!data?.history?.length && (
        <div className="mt-4">
          <button type="button" className="flex items-center gap-1.5 text-sm font-medium text-emerald-800 underline-offset-2 hover:underline dark:text-emerald-400" onClick={() => setShowHistory((s) => !s)} aria-expanded={showHistory}>
            <History className="size-4" aria-hidden="true" /> {showHistory ? 'Hide past changes' : `Past changes (${data.history.length})`}
          </button>
          {showHistory && (
            <ol className="mt-3 space-y-3">
              {data.history.map((change) => (
                <li key={change.id} className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {shortDate(change.createdAt)} &middot; {change.requestedByUser?.name ?? 'Facility administrator'} &middot;{' '}
                    <span className="font-medium text-slate-700 dark:text-slate-300">{STATUS_LABELS[change.status]}</span>
                  </p>
                  <ChangeTable change={change} />
                  {change.note && <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Why: {change.note}</p>}
                  {change.reviewNote && <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Bulamu: {change.reviewNote}</p>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Card>
  );
}
