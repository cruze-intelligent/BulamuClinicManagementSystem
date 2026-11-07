'use client';

import { useMemo, useState } from 'react';
import { Banknote, CalendarClock, FileDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { downloadWithAuth } from '@/lib/download';
import { shortDate } from '@/lib/finance';
import {
  MAX_CASH_MONTHS, MAX_GRACE_DAYS, cashProblem, graceCandidate, graceStatus, money, shillings,
  type BillingFacility, type CashForm,
} from '@/lib/subscription-admin';

const API = process.env.NEXT_PUBLIC_API_URL;

async function post(path: string, body: object) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error || 'That did not work - please try again.');
  return data;
}

// A fresh key for each payment typed in, so sending the same one twice
// (a double click, a retry on a weak connection) records it once.
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const emptyForm = (): CashForm => ({ facilityId: '', months: '1', amount: '', paidBy: '', reference: '' });

/**
 * For the Bulamu administrator: record cash a facility paid on a visit (the
 * date and time are taken when it is saved, for the receipt), and give a paid
 * facility whose subscription ran out up to 7 days' grace.
 */
export function CashAndGraceCard({ facilities, onChanged }: { facilities: BillingFacility[]; onChanged: () => void }) {
  const [form, setForm] = useState<CashForm>(emptyForm);
  const [notice, setNotice] = useState('');
  const [requestKey, setRequestKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [lastReceipt, setLastReceipt] = useState<{ path: string; name: string } | null>(null);
  const [graceDays, setGraceDays] = useState<Record<string, number>>({});
  const [graceBusy, setGraceBusy] = useState<string | null>(null);
  const [graceError, setGraceError] = useState<Record<string, string>>({});

  const payable = useMemo(
    () => facilities.filter((f) => f.subscription && f.subscription.amount > 0).sort((a, b) => a.name.localeCompare(b.name)),
    [facilities],
  );
  const chosen = payable.find((f) => f.id === form.facilityId);
  const currency = chosen?.subscription?.currency ?? 'UGX';
  const lapsed = facilities.filter((f) => graceCandidate(f)).sort((a, b) => a.name.localeCompare(b.name));

  // The amount follows the facility and months chosen; the administrator checks it against the cash counted.
  const pick = (patch: Partial<CashForm>) =>
    setForm((f) => {
      const next = { ...f, ...patch };
      const facility = payable.find((p) => p.id === next.facilityId);
      if ((patch.facilityId !== undefined || patch.months !== undefined) && facility?.subscription) {
        next.amount = (facility.subscription.amount * Number(next.months)).toLocaleString('en-US');
      }
      return next;
    });

  const record = async (event: React.FormEvent) => {
    event.preventDefault();
    setNotice('');
    const wrong = cashProblem(form, chosen);
    if (wrong) return setProblem(wrong);
    const amount = shillings(form.amount);
    const months = Number(form.months);
    if (!confirm(`Record ${money(currency, amount)} in cash from ${form.paidBy.trim()} for ${chosen!.name}, covering ${months === 1 ? '1 month' : `${months} months`}? The receipt is emailed to the facility.`)) return;
    setBusy(true);
    setProblem('');
    try {
      const data = await post(`/billing/cash/${form.facilityId}`, {
        months, amount, paidBy: form.paidBy.trim(), ...(form.reference.trim() ? { reference: form.reference.trim() } : {}), requestKey,
      });
      setLastReceipt({ path: data.receiptPath, name: chosen!.name });
      onChanged();
      setNotice(`${money(currency, amount)} in cash from ${chosen!.name} is recorded. It is paid until ${shortDate(data.paidUntil)}, and the receipt is being emailed to its administrator.`);
      setForm(emptyForm());
      setRequestKey(newKey());
    } catch (error: any) {
      setProblem(navigator.onLine ? error.message : 'You are offline - nothing was recorded. Try again when the connection returns.');
    } finally {
      setBusy(false);
    }
  };

  const giveGrace = async (facility: BillingFacility, remaining: number) => {
    const days = Math.min(graceDays[facility.id] ?? remaining, remaining);
    setGraceBusy(facility.id);
    setGraceError((e) => ({ ...e, [facility.id]: '' }));
    try {
      const data = await post(`/billing/grace/${facility.id}`, { days });
      onChanged();
      setNotice(`${facility.name} can keep working until ${shortDate(data.graceEndsAt)} (${days} grace day${days === 1 ? '' : 's'} given).${data.emailed ? ' Its administrator has been emailed.' : ''}`);
    } catch (error: any) {
      setGraceError((e) => ({ ...e, [facility.id]: error.message }));
    } finally {
      setGraceBusy(null);
    }
  };

  return (
    <Card className="rounded-lg p-5" data-testid="cash-and-grace">
      <div className="flex items-center gap-2">
        <Banknote className="size-4 text-emerald-700" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Cash payments</h2>
      </div>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        For cash handed over on a visit. The date and time are recorded when you save, and the facility is emailed its receipt.
      </p>

      <form onSubmit={record} className="mt-4 grid gap-3" noValidate>
        <div>
          <Label htmlFor="cash-facility">Facility</Label>
          <Select id="cash-facility" value={form.facilityId} onChange={(e) => pick({ facilityId: e.target.value })}>
            <option value="">Choose the facility that paid</option>
            {payable.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.facilityCode})</option>)}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="cash-months">Months paid</Label>
            <Select id="cash-months" value={form.months} onChange={(e) => pick({ months: e.target.value })}>
              {Array.from({ length: MAX_CASH_MONTHS }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} month{n === 1 ? '' : 's'}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="cash-amount">Cash received ({currency})</Label>
            <Input id="cash-amount" inputMode="numeric" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
          </div>
        </div>
        <div>
          <Label htmlFor="cash-paid-by">Paid by</Label>
          <Input id="cash-paid-by" value={form.paidBy} onChange={(e) => setForm((f) => ({ ...f, paidBy: e.target.value }))} maxLength={100} placeholder="Name of the person who handed it over" />
        </div>
        <div>
          <Label htmlFor="cash-reference">Receipt book number <span className="font-normal text-slate-500">(optional)</span></Label>
          <Input id="cash-reference" value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} maxLength={60} />
        </div>
        {problem && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{problem}</p>}
        {notice && <p role="status" className="text-sm text-emerald-800 dark:text-emerald-300">{notice}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Banknote className="size-4" aria-hidden="true" />}
            {busy ? 'Recording...' : 'Record cash payment'}
          </Button>
          {lastReceipt && (
            <Button type="button" variant="outline" onClick={() => downloadWithAuth(`${API}${lastReceipt.path}`, localStorage.getItem('token'), `bulamu-receipt-${lastReceipt.name}.pdf`).catch(() => {})}>
              <FileDown className="size-4" aria-hidden="true" /> Receipt for {lastReceipt.name}
            </Button>
          )}
        </div>
      </form>

      <div className="mt-6 border-t border-slate-200 pt-5 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 text-emerald-700" aria-hidden="true" />
          <h3 className="font-semibold text-slate-950 dark:text-slate-50">Grace days</h3>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          A paid facility whose subscription ran out can keep working for up to {MAX_GRACE_DAYS} days while it arranges payment. The days count towards its next payment.
        </p>
        {lapsed.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">No paid facility has run out right now.</p>
        ) : (
          <ul className="mt-3 max-h-[26rem] space-y-3 overflow-y-auto">
            {lapsed.map((facility) => {
              const remaining = Math.max(0, MAX_GRACE_DAYS - (facility.subscription?.graceDays ?? 0));
              return (
                <li key={facility.id} className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
                  <p className="font-medium text-slate-950 dark:text-slate-50">{facility.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{graceStatus(facility)}</p>
                  {remaining > 0 ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <label htmlFor={`grace-${facility.id}`} className="sr-only">Grace days for {facility.name}</label>
                      <Select
                        id={`grace-${facility.id}`}
                        className="h-8 w-28"
                        value={String(Math.min(graceDays[facility.id] ?? remaining, remaining))}
                        onChange={(e) => setGraceDays((d) => ({ ...d, [facility.id]: Number(e.target.value) }))}
                      >
                        {Array.from({ length: remaining }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} day{n === 1 ? '' : 's'}</option>)}
                      </Select>
                      <Button size="sm" variant="outline" disabled={graceBusy === facility.id} onClick={() => giveGrace(facility, remaining)}>
                        {graceBusy === facility.id ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CalendarClock className="size-4" aria-hidden="true" />}
                        {graceBusy === facility.id ? 'Giving...' : 'Give grace days'}
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">All {MAX_GRACE_DAYS} grace days given - it needs to pay to keep working.</p>
                  )}
                  {graceError[facility.id] && <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">{graceError[facility.id]}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
