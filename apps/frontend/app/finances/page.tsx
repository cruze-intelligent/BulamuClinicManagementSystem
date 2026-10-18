'use client';

import { useCallback, useEffect, useState } from 'react';
import { Ban, Download, Loader2, Printer, Plus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useAuth } from '@/lib/useAuth';
import { downloadWithAuth } from '@/lib/download';
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, categoryLabel, kampalaToday, methodLabel, parseShillings, shortDate, shortTime, ugx } from '@/lib/finance';

type MethodTotal = { method: string; label: string; total: number; count: number };
type Takings = {
  date: string; scope: 'mine' | 'everyone'; total: number; count: number; expenses?: number; cashInHand?: number;
  byMethod: MethodTotal[];
  byStaff: Array<{ userId: string | null; name: string; role: string; total: number; count: number; byMethod: MethodTotal[] }>;
  payments: Array<{ id: string; receiptNumber: string; receivedAt: string; amount: number; methodLabel: string; reference: string | null; patientName: string; receivedBy: string | null; voidedAt: string | null; voidReason: string | null }>;
};
type Summary = {
  month: string; income: number; previousIncome: number; payments: number; byMethod: MethodTotal[]; byDay: Array<{ date: string; total: number }>;
  billed: Array<{ kind: string; label: string; total: number; count: number }>; expenses: number;
  expensesByCategory: Array<{ category: string; label: string; total: number; count: number }>; net: number; outstanding: number; outstandingCount: number;
};
type Expense = {
  id: string; category: string; description: string; amount: number; spentOn: string; method: string | null; paidTo: string | null; reference: string | null;
  recordedBy: { name: string } | null; voidedAt: string | null; voidReason: string | null;
};

const API = process.env.NEXT_PUBLIC_API_URL;
const headers = (json = false) => ({ Authorization: `Bearer ${localStorage.getItem('token')}`, ...(json ? { 'Content-Type': 'application/json' } : {}) });
const clinicId = () => JSON.parse(localStorage.getItem('user') || '{}').clinicId as string;
const monthName = (month: string) => new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

async function get(path: string) {
  const res = await fetch(`${API}${path}`, { headers: headers() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error || 'Could not load this - please try again.');
  return data;
}

const TABS = [['day', "Day's takings"], ['month', 'The month'], ['expenses', 'Expenses']] as const;

export default function FinancesPage() {
  const { hasRole } = useAuth();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('day');

  if (!hasRole('ADMIN')) {
    return (
      <div className="min-h-screen bg-slate-50 p-8 dark:bg-slate-950">
        <Card className="mx-auto max-w-lg p-6 text-center text-slate-600 dark:text-slate-400">The facility&apos;s finances are for its administrators. Your own takings are on Bills &amp; Payments.</Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8 dark:bg-slate-950">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Finances</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
          The money your facility received from patients, day by day and month by month, set against what it paid out. Bulamu keeps the record; the money is your facility&apos;s.
        </p>
        <div role="tablist" aria-label="Finances" className="mb-6 mt-5 inline-flex flex-wrap rounded-md border border-slate-200 bg-white p-1 print:hidden dark:border-slate-700 dark:bg-slate-900">
          {TABS.map(([value, label]) => (
            <button
              key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)}
              className={`rounded px-4 py-1.5 text-sm font-medium ${tab === value ? 'bg-emerald-700 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'day' && <DayTakings />}
        {tab === 'month' && <MonthSummary />}
        {tab === 'expenses' && <Expenses />}
      </div>
    </div>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'good' | 'bad' }) {
  return (
    <Card className="gap-1 p-4">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${tone === 'bad' ? 'text-red-700 dark:text-red-400' : tone === 'good' ? 'text-emerald-700 dark:text-emerald-400' : ''}`}>{value}</p>
      {note && <p className="text-xs text-slate-500 dark:text-slate-400">{note}</p>}
    </Card>
  );
}

function Problem({ text }: { text: string }) {
  return <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{text}</p>;
}

/** One day's money: totals by method and by member of staff (for handing over), and every receipt. */
function DayTakings() {
  const [date, setDate] = useState(kampalaToday());
  const [takings, setTakings] = useState<Takings | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setTakings(null);
    get(`/finances/${clinicId()}/takings?date=${date}`).then((d) => { setTakings(d.takings); setError(''); }).catch((e) => setError(e.message));
  }, [date]);

  return (
    <section aria-label="Day's takings">
      <div className="mb-4 flex flex-wrap items-end gap-3 print:hidden">
        <div>
          <Label htmlFor="takings-date" className="text-xs">Day</Label>
          <Input id="takings-date" type="date" value={date} max={kampalaToday()} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-44" />
        </div>
        <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="size-4" aria-hidden="true" />Print</Button>
      </div>
      {error && <Problem text={error} />}
      {!takings ? (
        !error && <p className="text-sm text-slate-500"><Loader2 className="mr-2 inline size-4 animate-spin" aria-hidden="true" />Loading...</p>
      ) : (
        <>
          <h2 className="mb-3 hidden text-lg font-semibold print:block">Takings for {shortDate(`${takings.date}T12:00:00Z`)}</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Received" value={ugx(takings.total)} note={`${takings.count} receipt${takings.count === 1 ? '' : 's'}`} />
            <Stat label="Cash expected in the drawer" value={ugx(takings.cashInHand ?? 0)} note="Cash received, less cash paid out this day" />
            <Stat label="Paid out" value={ugx(takings.expenses ?? 0)} note="Expenses recorded for this day" />
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Card className="p-4">
              <h3 className="font-semibold">By how it was paid</h3>
              {takings.byMethod.length === 0 ? <p className="mt-2 text-sm text-slate-500">Nothing received.</p> : (
                <ul className="mt-3 space-y-2">
                  {takings.byMethod.map((m) => (
                    <li key={m.method} className="text-sm">
                      <div className="flex justify-between"><span>{m.label} <span className="text-slate-500">({m.count})</span></span><span className="shrink-0 whitespace-nowrap font-medium tabular-nums">{ugx(m.total)}</span></div>
                      <div className="mt-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-1.5 rounded-full bg-emerald-600" style={{ width: `${takings.total ? (m.total / takings.total) * 100 : 0}%` }} /></div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card className="p-4">
              <h3 className="font-semibold">By member of staff</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">What each person should hand over.</p>
              {takings.byStaff.length === 0 ? <p className="mt-2 text-sm text-slate-500">Nothing received.</p> : (
                <table className="mt-3 w-full text-sm">
                  <thead><tr className="text-left text-xs text-slate-500"><th className="pb-1 font-medium">Who</th><th className="pb-1 font-medium">How</th><th className="pb-1 text-right font-medium">Total</th></tr></thead>
                  <tbody>
                    {takings.byStaff.map((s) => (
                      <tr key={s.userId ?? 'unknown'} className="border-t border-slate-100 align-top dark:border-slate-800">
                        <td className="py-1.5">{s.name}<span className="block text-xs text-slate-500">{s.role}</span></td>
                        <td className="py-1.5 text-xs text-slate-600 dark:text-slate-400">{s.byMethod.map((m) => `${m.label} ${ugx(m.total)}`).join(', ')}</td>
                        <td className="whitespace-nowrap py-1.5 text-right font-medium tabular-nums">{ugx(s.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>

          <Card className="mt-4 overflow-x-auto p-4">
            <h3 className="font-semibold">Receipts</h3>
            {takings.payments.length === 0 ? <p className="mt-2 text-sm text-slate-500">No receipts on this day.</p> : (
              <table className="mt-3 w-full min-w-[36rem] text-sm">
                <thead><tr className="text-left text-xs text-slate-500"><th className="pb-1 font-medium">Receipt</th><th className="pb-1 font-medium">Time</th><th className="pb-1 font-medium">Patient</th><th className="pb-1 font-medium">How</th><th className="pb-1 font-medium">Taken by</th><th className="pb-1 text-right font-medium">Amount</th></tr></thead>
                <tbody>
                  {takings.payments.map((p) => (
                    <tr key={p.id} className={`border-t border-slate-100 dark:border-slate-800 ${p.voidedAt ? 'text-slate-400 line-through' : ''}`} title={p.voidReason ? `Void: ${p.voidReason}` : undefined}>
                      <td className="py-1.5 font-mono text-xs">{p.receiptNumber}{p.voidedAt && <span className="ml-1 font-sans text-red-600 no-underline">VOID</span>}</td>
                      <td className="py-1.5">{shortTime(p.receivedAt)}</td>
                      <td className="py-1.5">{p.patientName}</td>
                      <td className="py-1.5">{p.methodLabel}{p.reference ? <span className="block text-xs text-slate-500">{p.reference}</span> : null}</td>
                      <td className="py-1.5">{p.receivedBy ?? '-'}</td>
                      <td className="py-1.5 text-right tabular-nums">{p.amount.toLocaleString('en-US')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </section>
  );
}

/** A month: money in against money out, what each service brought in, and what is still owed. */
function MonthSummary() {
  const [month, setMonth] = useState(kampalaToday().slice(0, 7));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setSummary(null);
    get(`/finances/${clinicId()}/summary?month=${month}`).then((d) => { setSummary(d.summary); setError(''); }).catch((e) => setError(e.message));
  }, [month]);

  const peak = summary ? Math.max(1, ...summary.byDay.map((d) => d.total)) : 1;
  const change = summary && summary.previousIncome ? Math.round(((summary.income - summary.previousIncome) / summary.previousIncome) * 100) : null;

  return (
    <section aria-label="The month">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="summary-month" className="text-xs">Month</Label>
          <Input id="summary-month" type="month" value={month} max={kampalaToday().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-44" />
        </div>
        <Button variant="outline" size="sm" onClick={() => downloadWithAuth(`${API}/finances/${clinicId()}/export?month=${month}`, localStorage.getItem('token'), `finances-${month}.csv`).catch((e) => setError(e.message))}>
          <Download className="size-4" aria-hidden="true" />Spreadsheet for your books
        </Button>
      </div>
      {error && <Problem text={error} />}
      {!summary ? (
        !error && <p className="text-sm text-slate-500"><Loader2 className="mr-2 inline size-4 animate-spin" aria-hidden="true" />Loading...</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={`Received in ${monthName(summary.month)}`} value={ugx(summary.income)} note={change === null ? `${summary.payments} payments` : `${change >= 0 ? '+' : ''}${change}% on the month before`} />
            <Stat label="Paid out" value={ugx(summary.expenses)} note="Recorded expenses" />
            <Stat label="Left over" value={ugx(summary.net)} tone={summary.net < 0 ? 'bad' : 'good'} note="Received less paid out" />
            <Stat label="Still owed today" value={ugx(summary.outstanding)} note={`on ${summary.outstandingCount} bill${summary.outstandingCount === 1 ? '' : 's'}`} />
          </div>

          <Card className="mt-4 p-4">
            <h3 className="font-semibold">Received each day</h3>
            <div className="mt-4 flex h-40 items-end gap-[2px]" role="img" aria-label={`Money received each day of ${monthName(summary.month)}; the table below has the figures`}>
              {summary.byDay.map((d) => (
                <div key={d.date} className="group relative flex h-full flex-1 items-end">
                  <div className="w-full rounded-t-[4px] bg-emerald-600 dark:bg-emerald-500" style={{ height: `${(d.total / peak) * 100}%`, minHeight: d.total ? 2 : 0 }} />
                  <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs text-white group-hover:block">
                    {Number(d.date.slice(8))} {monthName(summary.month).split(' ')[0].slice(0, 3)}: {ugx(d.total)}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-xs text-slate-500"><span>1</span><span>{summary.byDay.length}</span></div>
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-slate-600 dark:text-slate-400">Show as a table</summary>
              <table className="mt-2 w-full max-w-sm">
                <tbody>
                  {summary.byDay.filter((d) => d.total > 0).map((d) => (
                    <tr key={d.date} className="border-t border-slate-100 dark:border-slate-800"><td className="py-1">{shortDate(`${d.date}T12:00:00Z`)}</td><td className="py-1 text-right tabular-nums">{ugx(d.total)}</td></tr>
                  ))}
                </tbody>
              </table>
            </details>
          </Card>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Breakdown title="By how it was paid" rows={summary.byMethod.map((m) => ({ key: m.method, label: m.label, total: m.total }))} />
            <Breakdown title="Billed, by service" note="Charges raised this month, paid or not" rows={summary.billed.map((b) => ({ key: b.kind, label: b.label, total: b.total }))} />
            <Breakdown title="Paid out, by category" rows={summary.expensesByCategory.map((e) => ({ key: e.category, label: e.label, total: e.total }))} />
          </div>
        </>
      )}
    </section>
  );
}

function Breakdown({ title, note, rows }: { title: string; note?: string; rows: Array<{ key: string; label: string; total: number }> }) {
  const sum = rows.reduce((s, r) => s + r.total, 0);
  return (
    <Card className="p-4">
      <h3 className="font-semibold">{title}</h3>
      {note && <p className="text-xs text-slate-500 dark:text-slate-400">{note}</p>}
      {rows.length === 0 ? <p className="mt-2 text-sm text-slate-500">Nothing this month.</p> : (
        <ul className="mt-3 space-y-2 text-sm">
          {rows.map((r) => (
            <li key={r.key}>
              <div className="flex justify-between gap-2"><span>{r.label}</span><span className="shrink-0 whitespace-nowrap font-medium tabular-nums">{ugx(r.total)}</span></div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-1.5 rounded-full bg-emerald-600" style={{ width: `${sum ? (r.total / sum) * 100 : 0}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Money paid out: recorded here, voided (never deleted) when entered by mistake. */
function Expenses() {
  const today = kampalaToday();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ spentOn: today, category: 'MEDICINES_SUPPLIES', description: '', amount: '', method: 'CASH', paidTo: '', reference: '' });

  const load = useCallback(() => {
    get(`/expenses/${clinicId()}?month=${month}`).then((d) => { setExpenses(d.expenses); setError(''); }).catch((e) => setError(e.message));
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseShillings(form.amount);
    if (!form.description.trim()) return setError('Describe the expense');
    if (!amount) return setError('Enter the amount, in whole shillings');
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API}/expenses`, { method: 'POST', headers: headers(true), body: JSON.stringify({ ...form, amount }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not record the expense');
      setNotice(`${ugx(amount)} for ${form.description.trim()} recorded.`);
      setForm((f) => ({ ...f, description: '', amount: '', paidTo: '', reference: '' }));
      if (form.spentOn.slice(0, 7) !== month) setMonth(form.spentOn.slice(0, 7)); else load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const voidExpense = async (expense: Expense) => {
    const reason = window.prompt(`Void "${expense.description}" (${ugx(expense.amount)})? It stays on record, marked void. Say why:`)?.trim();
    if (!reason) return;
    const res = await fetch(`${API}/expenses/${expense.id}/void`, { method: 'POST', headers: headers(true), body: JSON.stringify({ reason }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) return setError(data.error || 'Could not void the expense');
    load();
  };

  const standing = (expenses ?? []).filter((x) => !x.voidedAt);
  return (
    <section aria-label="Expenses" className="space-y-4">
      <Card className="p-4">
        <h3 className="font-semibold">Record money paid out</h3>
        <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-6">
          <div className="sm:col-span-2">
            <Label htmlFor="exp-date" className="text-xs">Date paid</Label>
            <Input id="exp-date" type="date" max={today} value={form.spentOn} onChange={(e) => setForm({ ...form, spentOn: e.target.value })} />
          </div>
          <div className="sm:col-span-4">
            <Label htmlFor="exp-category" className="text-xs">What for</Label>
            <Select id="exp-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
          </div>
          <div className="sm:col-span-4">
            <Label htmlFor="exp-description" className="text-xs">Description</Label>
            <Input id="exp-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Restock of antimalarials" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="exp-amount" className="text-xs">Amount (UGX)</Label>
            <Input id="exp-amount" inputMode="numeric" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="exp-method" className="text-xs">Paid by</Label>
            <Select id="exp-method" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
              {PAYMENT_METHODS.filter((m) => m.value !== 'INSURANCE').map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="exp-paid-to" className="text-xs">Paid to (optional)</Label>
            <Input id="exp-paid-to" value={form.paidTo} onChange={(e) => setForm({ ...form, paidTo: e.target.value })} placeholder="e.g. Joint Medical Store" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="exp-reference" className="text-xs">Reference (optional)</Label>
            <Input id="exp-reference" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Receipt or transfer number" />
          </div>
          <div className="sm:col-span-6">
            <Button type="submit" disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}Record the expense</Button>
          </div>
        </form>
      </Card>

      {notice && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">{notice}</p>}
      {error && <Problem text={error} />}

      <Card className="overflow-x-auto p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-semibold">Paid out in {monthName(month)}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">{ugx(standing.reduce((s, x) => s + x.amount, 0))} in {standing.length} expense{standing.length === 1 ? '' : 's'}</p>
          </div>
          <div>
            <Label htmlFor="exp-month" className="text-xs">Month</Label>
            <Input id="exp-month" type="month" value={month} max={today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-44" />
          </div>
        </div>
        {expenses === null ? (
          !error && <p className="mt-3 text-sm text-slate-500"><Loader2 className="mr-2 inline size-4 animate-spin" aria-hidden="true" />Loading...</p>
        ) : expenses.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No expenses recorded for this month.</p>
        ) : (
          <table className="mt-3 w-full min-w-[36rem] text-sm">
            <thead><tr className="text-left text-xs text-slate-500"><th className="pb-1 font-medium">Date</th><th className="pb-1 font-medium">What for</th><th className="pb-1 font-medium">Paid</th><th className="pb-1 text-right font-medium">Amount</th><th className="pb-1" /></tr></thead>
            <tbody>
              {expenses.map((x) => (
                <tr key={x.id} className={`border-t border-slate-100 align-top dark:border-slate-800 ${x.voidedAt ? 'text-slate-400' : ''}`}>
                  <td className="py-1.5">{shortDate(x.spentOn)}</td>
                  <td className={`py-1.5 ${x.voidedAt ? 'line-through' : ''}`}>{x.description}<span className="block text-xs text-slate-500">{categoryLabel(x.category)}{x.recordedBy ? ` · recorded by ${x.recordedBy.name}` : ''}</span></td>
                  <td className="py-1.5">{methodLabel(x.method)}{x.paidTo ? ` to ${x.paidTo}` : ''}{x.reference ? <span className="block text-xs text-slate-500">{x.reference}</span> : null}</td>
                  <td className={`py-1.5 text-right tabular-nums ${x.voidedAt ? 'line-through' : ''}`}>{x.amount.toLocaleString('en-US')}</td>
                  <td className="py-1.5 text-right">
                    {x.voidedAt
                      ? <span className="text-xs font-medium text-red-600" title={x.voidReason ?? undefined}>VOID</span>
                      : <Button size="sm" variant="ghost" onClick={() => voidExpense(x)} aria-label={`Void ${x.description}`}><Ban className="size-4" aria-hidden="true" /></Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </section>
  );
}
