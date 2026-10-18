'use client';

import { useState } from 'react';
import { CalendarPlus, Hourglass, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';

/** The most days the platform administrator may add to one facility's trial, in all (the API enforces it too). */
export const MAX_TRIAL_EXTENSION_DAYS = 14;

export type TrialFacility = {
  id: string;
  name: string;
  facilityCode: string;
  subscription: { status: string; trialEndsAt: string; trialExtendedDays?: number; lastPaymentAt?: string | null } | null;
};

const DAY = 24 * 60 * 60 * 1000;

/** On its free trial - including a trial that ran out without payment. */
export function isOnTrial(facility: TrialFacility): boolean {
  const s = facility.subscription;
  return !!s && (s.status === 'TRIALING' || (s.status === 'PAST_DUE' && !s.lastPaymentAt));
}

function endsLabel(trialEndsAt: string, now = Date.now()): string {
  const end = new Date(trialEndsAt);
  const date = end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const days = Math.ceil((end.getTime() - now) / DAY);
  if (days > 1) return `Ends ${date} (in ${days} days)`;
  if (days === 1) return `Ends ${date} (tomorrow)`;
  if (days === 0) return `Ends today`;
  return `Ended ${date}, unpaid`;
}

/**
 * Facilities on their free trial, soonest to end first, with a way to give
 * one more days - at most 14 in all.
 */
export function TrialExtensionsCard({ facilities, onExtended }: { facilities: TrialFacility[]; onExtended: (message: string) => void }) {
  const [days, setDays] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Record<string, string>>({});

  const trials = facilities.filter(isOnTrial).sort((a, b) => a.subscription!.trialEndsAt.localeCompare(b.subscription!.trialEndsAt));

  const extend = async (facility: TrialFacility, remaining: number) => {
    const chosen = Math.min(days[facility.id] ?? Math.min(7, remaining), remaining);
    setBusy(facility.id);
    setError((e) => ({ ...e, [facility.id]: '' }));
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/billing/trial/${facility.id}/extend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ days: chosen }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not extend the trial');
      const until = new Date(data.trialEndsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      onExtended(`${facility.name}'s free trial now runs until ${until} (${chosen} day${chosen === 1 ? '' : 's'} added).${data.emailed ? ' Its administrator has been emailed.' : ''}`);
    } catch (e: any) {
      setError((prev) => ({ ...prev, [facility.id]: e.message || 'Could not extend the trial' }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="rounded-lg p-5" data-testid="free-trials">
      <div className="flex items-center gap-2">
        <Hourglass className="size-4 text-emerald-700" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Free trials</h2>
      </div>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        A trial can be extended by up to {MAX_TRIAL_EXTENSION_DAYS} days in all. The facility&apos;s administrator is emailed.
      </p>
      {trials.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">No facility is on a free trial right now.</p>
      ) : (
        <ul className="mt-4 max-h-[26rem] space-y-3 overflow-y-auto">
          {trials.map((facility) => {
            const s = facility.subscription!;
            const used = s.trialExtendedDays ?? 0;
            const remaining = Math.max(0, MAX_TRIAL_EXTENSION_DAYS - used);
            const ended = new Date(s.trialEndsAt).getTime() < Date.now();
            return (
              <li key={facility.id} className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
                <p className="font-medium text-slate-950 dark:text-slate-50">{facility.name}</p>
                <p className={`text-xs ${ended ? 'text-rose-700 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>
                  {endsLabel(s.trialEndsAt)}{used > 0 && ` - extended by ${used} of ${MAX_TRIAL_EXTENSION_DAYS} days`}
                </p>
                {remaining > 0 ? (
                  <div className="mt-2 flex items-center gap-2">
                    <label htmlFor={`extend-${facility.id}`} className="sr-only">Days to add to {facility.name}&apos;s trial</label>
                    <Select
                      id={`extend-${facility.id}`}
                      className="h-8 w-28"
                      value={String(Math.min(days[facility.id] ?? Math.min(7, remaining), remaining))}
                      onChange={(e) => setDays((d) => ({ ...d, [facility.id]: Number(e.target.value) }))}
                    >
                      {Array.from({ length: remaining }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>{n} day{n === 1 ? '' : 's'}</option>
                      ))}
                    </Select>
                    <Button size="sm" variant="outline" disabled={busy === facility.id} onClick={() => extend(facility, remaining)}>
                      {busy === facility.id ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CalendarPlus className="size-4" aria-hidden="true" />}
                      {busy === facility.id ? 'Extending...' : 'Extend trial'}
                    </Button>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Already extended by the full {MAX_TRIAL_EXTENSION_DAYS} days.</p>
                )}
                {error[facility.id] && <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">{error[facility.id]}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
