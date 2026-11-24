'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, CalendarClock, FileDown, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { downloadWithAuth } from '@/lib/download';
import { shortDate } from '@/lib/finance';
import {
  MAX_CASH_MONTHS, MAX_GRACE_DAYS, MOBILE_MONEY_NETWORKS, PAYMENT_METHODS, cashProblem, graceCandidate, graceStatus, methodOf, money, shillings,
  type BillingFacility, type CashForm, type PaymentMethod, type PendingPesapal,
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
const emptyForm = (): CashForm => ({ facilityId: '', months: '1', amount: '', paidBy: '', reference: '', method: 'CASH', provider: '', pesapalPaymentId: '' });

/**
 * For the Bulamu administrator: record a subscription payment made outside
 * Pesapal - cash on a visit, mobile money or a bank transfer sent to Bulamu -
 * or confirm a Pesapal payment whose confirmation is late (the date and time
 * are taken when it is saved, for the receipt); and give a paid facility whose
 * subscription ran out up to 7 days' grace.
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
  // Pesapal payments still waiting for Pesapal's confirmation.
  const [pending, setPending] = useState<PendingPesapal[]>([]);
  const [checking, setChecking] = useState<string | null>(null);

  const loadPending = useCallback(async () => {
    try {
      const res = await fetch(`${API}/billing/pesapal/pending`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      const data = await res.json();
      if (res.ok && data.success) setPending(data.payments);
    } catch {
      // Offline: the list comes back with the connection.
    }
  }, []);
  useEffect(() => { void loadPending(); }, [loadPending]);

  const payable = useMemo(
    () => facilities.filter((f) => f.subscription && f.subscription.amount > 0).sort((a, b) => a.name.localeCompare(b.name)),
    [facilities],
  );
  const chosen = payable.find((f) => f.id === form.facilityId);
  const currency = chosen?.subscription?.currency ?? 'UGX';
  const method = methodOf(form);
  const waitingHere = pending.filter((p) => p.clinicId === form.facilityId);
  const nameOf = (clinicId: string) => facilities.find((f) => f.id === clinicId)?.name ?? 'A facility';
  const lapsed = facilities.filter((f) => graceCandidate(f)).sort((a, b) => a.name.localeCompare(b.name));

  // The amount follows the facility and months chosen; the administrator checks it against the cash counted.
  const pick = (patch: Partial<CashForm>) =>
    setForm((f) => {
      const next = { ...f, ...patch };
      const facility = payable.find((p) => p.id === next.facilityId);
      if ((patch.facilityId !== undefined || patch.months !== undefined || patch.method !== undefined) && facility?.subscription) {
        next.amount = (facility.subscription.amount * Number(next.months)).toLocaleString('en-US');
      }
      // A late Pesapal payment: the one waiting for this facility, for what it was charged.
      if (next.method === 'PESAPAL') {
        const waiting = pending.find((p) => p.id === next.pesapalPaymentId && p.clinicId === next.facilityId) ?? pending.find((p) => p.clinicId === next.facilityId);
        next.pesapalPaymentId = waiting?.id ?? '';
        if (waiting) { next.amount = waiting.amount.toLocaleString('en-US'); next.months = String(waiting.months); }
      }
      return next;
    });

  const record = async (event: React.FormEvent) => {
    event.preventDefault();
    setNotice('');
    const wrong = cashProblem(form, chosen, pending);
    if (wrong) return setProblem(wrong);
    const amount = shillings(form.amount);
    const months = Number(form.months);
    const how = method.value === 'CASH' ? 'in cash' : method.value === 'MOBILE_MONEY' ? `by ${form.provider}` : method.value === 'BANK_TRANSFER' ? 'by bank transfer' : 'through Pesapal (confirming it by hand)';
    if (!confirm(`Record ${money(currency, amount)} ${how} from ${form.paidBy.trim()} for ${chosen!.name}, covering ${months === 1 ? '1 month' : `${months} months`}? The receipt is emailed to the facility.`)) return;
    setBusy(true);
    setProblem('');
    try {
      const data = await post(`/billing/manual/${form.facilityId}`, {
        method: method.value, months, amount, paidBy: form.paidBy.trim(), requestKey,
        ...(form.reference.trim() ? { reference: form.reference.trim() } : {}),
        ...(form.provider?.trim() ? { provider: form.provider.trim() } : {}),
        ...(method.value === 'PESAPAL' ? { pesapalPaymentId: form.pesapalPaymentId } : {}),
      });
      setLastReceipt({ path: data.receiptPath, name: chosen!.name });
      onChanged();
      void loadPending();
      setNotice(`${money(currency, amount)} ${how} from ${chosen!.name} is recorded. It is paid until ${shortDate(data.paidUntil)}, and the receipt is being emailed to its administrator.`);
      setForm(emptyForm());
      setRequestKey(newKey());
    } catch (error: any) {
      setProblem(navigator.onLine ? error.message : 'You are offline - nothing was recorded. Try again when the connection returns.');
    } finally {
      setBusy(false);
    }
  };

  // Pesapal's notice may have been lost: ask it again, before confirming by hand.
  const askPesapal = async (payment: PendingPesapal) => {
    setChecking(payment.id);
    setProblem('');
    try {
      const data = await post(`/billing/pesapal/${payment.id}/check`, {});
      setNotice(`${nameOf(payment.clinicId)}: ${data.message}`);
      if (data.outcome !== 'pending') { onChanged(); void loadPending(); }
    } catch (error: any) {
      setProblem(error.message);
    } finally {
      setChecking(null);
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
        <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Record a payment</h2>
      </div>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        For a subscription paid outside Pesapal - cash on a visit, mobile money or a bank transfer sent to Bulamu - or a Pesapal payment that is late to confirm. The date and time are recorded when you save, and the facility is emailed its receipt.
      </p>

      {pending.length > 0 && (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40" data-testid="pesapal-waiting">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">Pesapal payments waiting to be confirmed</p>
          <ul className="mt-2 space-y-2">
            {pending.slice(0, 8).map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 text-slate-800 dark:text-slate-200">{nameOf(p.clinicId)} - {money(p.currency, p.amount)}, started {shortDate(p.createdAt)}</span>
                <Button size="sm" variant="outline" disabled={checking === p.id} onClick={() => void askPesapal(p)}>
                  {checking === p.id ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-4" aria-hidden="true" />}
                  Ask Pesapal again
                </Button>
                <Button size="sm" variant="outline" onClick={() => pick({ facilityId: p.clinicId, method: 'PESAPAL', pesapalPaymentId: p.id })}>Confirm by hand</Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={record} className="mt-4 grid gap-3" noValidate>
        <div>
          <Label htmlFor="cash-facility">Facility</Label>
          <Select id="cash-facility" value={form.facilityId} onChange={(e) => pick({ facilityId: e.target.value })}>
            <option value="">Choose the facility that paid</option>
            {payable.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.facilityCode})</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="cash-method">How it was paid</Label>
          <Select id="cash-method" value={method.value} onChange={(e) => pick({ method: e.target.value as PaymentMethod })}>
            {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
        </div>
        {method.value === 'MOBILE_MONEY' && (
          <div>
            <Label htmlFor="cash-network">Network</Label>
            <Select id="cash-network" value={form.provider ?? ''} onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}>
              <option value="">Choose the network</option>
              {MOBILE_MONEY_NETWORKS.map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </div>
        )}
        {method.value === 'BANK_TRANSFER' && (
          <div>
            <Label htmlFor="cash-bank">Bank <span className="font-normal text-slate-500">(optional)</span></Label>
            <Input id="cash-bank" value={form.provider ?? ''} onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))} maxLength={60} placeholder="e.g. Stanbic Bank" />
          </div>
        )}
        {method.value === 'PESAPAL' ? (
          <div>
            <Label htmlFor="cash-pesapal">The Pesapal payment</Label>
            {waitingHere.length ? (
              <Select id="cash-pesapal" value={form.pesapalPaymentId ?? ''} onChange={(e) => pick({ pesapalPaymentId: e.target.value })}>
                {waitingHere.map((p) => <option key={p.id} value={p.id}>{money(p.currency, p.amount)}, started {shortDate(p.createdAt)}</option>)}
              </Select>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">{form.facilityId ? 'This facility has no Pesapal payment waiting. Record the payment the way the money came.' : 'Choose the facility first.'}</p>
            )}
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Confirmed on its own record: if Pesapal confirms it later, nothing is added twice.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="cash-months">Months paid</Label>
              <Select id="cash-months" value={form.months} onChange={(e) => pick({ months: e.target.value })}>
                {Array.from({ length: MAX_CASH_MONTHS }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} month{n === 1 ? '' : 's'}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="cash-amount">Amount received ({currency})</Label>
              <Input id="cash-amount" inputMode="numeric" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
          </div>
        )}
        <div>
          <Label htmlFor="cash-paid-by">Paid by</Label>
          <Input id="cash-paid-by" value={form.paidBy} onChange={(e) => setForm((f) => ({ ...f, paidBy: e.target.value }))} maxLength={100} placeholder={method.value === 'CASH' ? 'Name of the person who handed it over' : 'Name, or the number it came from'} />
        </div>
        <div>
          <Label htmlFor="cash-reference">{method.reference} {!method.referenceRequired && <span className="font-normal text-slate-500">(optional)</span>}</Label>
          <Input id="cash-reference" value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} maxLength={60} placeholder={method.value === 'MOBILE_MONEY' ? 'e.g. the ID in the mobile money message' : undefined} />
        </div>
        {problem && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{problem}</p>}
        {notice && <p role="status" className="text-sm text-emerald-800 dark:text-emerald-300">{notice}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Banknote className="size-4" aria-hidden="true" />}
            {busy ? 'Recording...' : 'Record payment'}
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
