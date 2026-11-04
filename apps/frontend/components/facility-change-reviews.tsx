'use client';

import { useEffect, useState } from 'react';
import { FilePenLine, Loader2, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { shortDate } from '@/lib/finance';

const API = process.env.NEXT_PUBLIC_API_URL;

type WaitingChange = {
  id: string;
  clinic: { id: string; name: string; facilityCode: string };
  rows: Array<[string, string, string]>;
  note: string | null;
  createdAt: string;
  changesThisYear: number;
  requestedByUser: { name: string; email: string } | null;
};

/**
 * Facility detail changes waiting for a Bulamu administrator: a facility that
 * has already changed its details three times in twelve months needs each
 * further change checked. Shown only while something is waiting.
 */
export function FacilityChangeReviews() {
  const [changes, setChanges] = useState<WaitingChange[]>([]);
  const [deciding, setDeciding] = useState<Record<string, 'approve' | 'reject'>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');

  const load = async () => {
    try {
      const res = await fetch(`${API}/super-admin/facility-changes`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      const data = await res.json();
      if (data.success) setChanges(data.changes);
    } catch {
      // Left as it was; the next visit tries again.
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const decide = async (change: WaitingChange, decision: 'approve' | 'reject') => {
    let note: string | undefined;
    if (decision === 'reject') {
      const typed = window.prompt(`Why is the change for ${change.clinic.name} not being made? It is included in the email to them.`);
      if (typed === null) return;
      if (!typed.trim()) return setErrors((e) => ({ ...e, [change.id]: 'Give a reason - the facility needs to know what to put right.' }));
      note = typed.trim();
    }
    setDeciding((d) => ({ ...d, [change.id]: decision }));
    setErrors((e) => ({ ...e, [change.id]: '' }));
    try {
      const res = await fetch(`${API}/super-admin/facility-changes/${change.id}/${decision}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify(note ? { note } : {}),
      });
      const data = await res.json().catch(() => ({}));
      // Dealt with elsewhere (another tab, or the facility withdrew it): just refresh.
      if (!data.success && res.status !== 409) throw new Error(data.error || `Could not ${decision} the change`);
      if (!data.success) setNotice(data.error);
      else setNotice(decision === 'approve'
        ? `The new details for ${change.clinic.name} are in place. Their administrator is being emailed.`
        : `The change for ${change.clinic.name} was not made. Their administrator is being emailed the reason.`);
      setChanges((list) => list.filter((c) => c.id !== change.id));
      void load();
    } catch (error: any) {
      setErrors((e) => ({ ...e, [change.id]: navigator.onLine ? error.message : 'You are offline - try again when the connection returns.' }));
    } finally {
      setDeciding((d) => {
        const next = { ...d };
        delete next[change.id];
        return next;
      });
    }
  };

  if (changes.length === 0 && !notice) return null;

  return (
    <Card className="rounded-lg border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/30">
      <div className="flex items-center gap-2">
        <FilePenLine className="size-5 text-amber-700" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Facility details to review ({changes.length})</h2>
      </div>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        These facilities have already changed their details 3 times in 12 months, so each further change waits for you. Check it against what you know of the facility before approving.
      </p>
      {notice && <p role="status" className="mt-3 text-sm text-emerald-800 dark:text-emerald-300">{notice}</p>}
      <div className="mt-4 space-y-3">
        {changes.map((change) => (
          <div key={change.id} className="rounded-md border border-amber-200 bg-white p-4 dark:border-amber-900 dark:bg-slate-900">
            <p className="font-medium text-slate-950 dark:text-slate-50">
              {change.clinic.name} <span className="font-mono text-xs font-normal text-slate-400">({change.clinic.facilityCode})</span>
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Asked on {shortDate(change.createdAt)} by {change.requestedByUser ? `${change.requestedByUser.name} (${change.requestedByUser.email})` : 'the facility administrator'}
              {' '}&middot; {change.changesThisYear} changes made in the last 12 months
            </p>
            <dl className="mt-3 grid gap-1 text-sm">
              {change.rows.map(([label, from, to]) => (
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
            {change.note && <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">Why: {change.note}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" disabled={!!deciding[change.id]} onClick={() => decide(change, 'approve')}>
                {deciding[change.id] === 'approve' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ThumbsUp className="size-4" aria-hidden="true" />}
                {deciding[change.id] === 'approve' ? 'Approving...' : 'Approve and make the change'}
              </Button>
              <Button size="sm" variant="outline" disabled={!!deciding[change.id]} onClick={() => decide(change, 'reject')}>
                {deciding[change.id] === 'reject' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ThumbsDown className="size-4" aria-hidden="true" />}
                {deciding[change.id] === 'reject' ? 'Turning down...' : 'Turn down'}
              </Button>
            </div>
            {errors[change.id] && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">{errors[change.id]}</p>}
          </div>
        ))}
      </div>
    </Card>
  );
}
