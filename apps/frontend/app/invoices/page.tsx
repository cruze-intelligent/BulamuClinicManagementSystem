'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Loader2, Plus, Search, Trash2, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { BillPanel, STATE_STYLE, type Bill } from '@/components/bill-panel';
import { useAuth } from '@/lib/useAuth';
import { CHARGE_KINDS, parseShillings, shortDate, ugx, type ChargeKind } from '@/lib/finance';

const FILTERS = [
  { value: 'OPEN', label: 'Still owed' },
  { value: 'UNPAID', label: 'Unpaid' },
  { value: 'PART_PAID', label: 'Part paid' },
  { value: 'PAID', label: 'Paid' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'all', label: 'All' },
] as const;

type Takings = { total: number; count: number; scope: 'mine' | 'everyone'; byMethod: Array<{ label: string; total: number }>; cashInHand?: number };
type Patient = { id: string; name: string; phone: string };

const API = process.env.NEXT_PUBLIC_API_URL;
const headers = (json = false) => ({ Authorization: `Bearer ${localStorage.getItem('token')}`, ...(json ? { 'Content-Type': 'application/json' } : {}) });

export default function BillsPage() {
  const { user, hasRole } = useAuth();
  const isAdmin = hasRole('ADMIN');
  const [bills, setBills] = useState<Bill[]>([]);
  const [outstanding, setOutstanding] = useState({ outstanding: 0, outstandingCount: 0 });
  const [takings, setTakings] = useState<Takings | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['value']>('OPEN');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const clinicName = (user as any)?.clinic?.name ?? 'Your facility';

  const load = useCallback(async () => {
    const clinicId = JSON.parse(localStorage.getItem('user') || '{}').clinicId;
    if (!clinicId) return;
    try {
      const params = new URLSearchParams();
      if (filter !== 'all') params.set('status', filter);
      if (query.trim()) params.set('q', query.trim());
      const [list, today] = await Promise.all([
        fetch(`${API}/invoices/${clinicId}?${params}`, { headers: headers() }).then((r) => r.json()),
        fetch(`${API}/finances/${clinicId}/takings`, { headers: headers() }).then((r) => r.json()).catch(() => null),
      ]);
      if (!list.success) throw new Error(list.error || 'Could not load bills');
      setBills(list.invoices);
      setOutstanding(list.summary);
      if (today?.success) setTakings(today.takings);
      setError('');
    } catch (err: any) {
      setError(typeof navigator !== 'undefined' && !navigator.onLine ? 'You are offline. Bills load when the connection returns.' : err.message || 'Could not load bills - please try again.');
    } finally {
      setLoading(false);
    }
  }, [filter, query]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  if (!hasRole('ADMIN', 'DOCTOR', 'NURSE', 'STAFF', 'PHARMACIST')) {
    return (
      <div className="min-h-screen bg-slate-50 p-8 dark:bg-slate-950">
        <Card className="mx-auto max-w-lg p-6 text-center text-slate-600 dark:text-slate-400">Bills and payments are handled at the front desk, by clinicians and at the pharmacy.</Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8 dark:bg-slate-950">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Bills &amp; Payments</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
              What each patient was charged - the visit, lab tests, medicines, ward stays - and every payment your facility received, each with a numbered receipt.
              Patients pay the facility as they always have; Bulamu keeps the record.
            </p>
          </div>
          <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" />New bill</Button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Card className="gap-1 p-4">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Still owed</p>
            <p className="text-2xl font-bold tabular-nums">{ugx(outstanding.outstanding)}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">on {outstanding.outstandingCount} bill{outstanding.outstandingCount === 1 ? '' : 's'}</p>
          </Card>
          <Card className="gap-1 p-4">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{takings?.scope === 'everyone' ? 'Received today' : 'You received today'}</p>
            <p className="text-2xl font-bold tabular-nums">{ugx(takings?.total ?? 0)}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {takings?.byMethod.length ? takings.byMethod.map((m) => `${m.label} ${ugx(m.total)}`).join(' · ') : 'No payments yet today'}
            </p>
          </Card>
          <Card className="gap-1 p-4">
            {takings?.scope === 'everyone' ? (
              <>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Cash expected in the drawer</p>
                <p className="text-2xl font-bold tabular-nums">{ugx(takings.cashInHand ?? 0)}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Cash received today, less cash paid out</p>
              </>
            ) : (
              <>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Your receipts today</p>
                <p className="text-2xl font-bold tabular-nums">{takings?.count ?? 0}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Hand the money over with this total</p>
              </>
            )}
          </Card>
        </div>

        <div className="mb-4 mt-6 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show bills">
            {FILTERS.map((f) => (
              <Button key={f.value} size="sm" variant={filter === f.value ? 'default' : 'outline'} aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
                {f.label}
              </Button>
            ))}
          </div>
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400" aria-hidden="true" />
            <Input aria-label="Find a patient's bills" placeholder="Patient name" className="pl-8" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>

        {error && <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

        {loading ? (
          <p className="text-sm text-slate-500"><Loader2 className="mr-2 inline size-4 animate-spin" aria-hidden="true" />Loading bills...</p>
        ) : bills.length === 0 ? (
          <Card className="p-6 text-sm text-slate-600 dark:text-slate-400">
            {filter === 'OPEN' && !query
              ? 'Nothing is owed right now. A fee entered when a visit is recorded opens a bill here; use New bill for anything else, such as medicine sold over the counter.'
              : 'No bills in this view.'}
          </Card>
        ) : (
          <ul className="space-y-2">
            {bills.map((bill) => (
              <li key={bill.id}>
                <button
                  type="button" onClick={() => setOpenId(bill.id)}
                  className="flex w-full items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-emerald-700"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-slate-900 dark:text-slate-100">{bill.patient.name}</span>
                    <span className="block truncate text-sm text-slate-500 dark:text-slate-400">
                      {bill.consultation ? bill.consultation.diagnosis : 'Without a visit'} · {shortDate(bill.createdAt)} · {bill.items.length || 1} item{bill.items.length === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block whitespace-nowrap font-semibold tabular-nums">{ugx(bill.amount)}</span>
                    {bill.state === 'Part paid' && <span className="block text-xs text-slate-500 dark:text-slate-400">{ugx(bill.balance)} owed</span>}
                  </span>
                  <span className={`hidden rounded px-2 py-1 text-xs font-medium sm:inline ${STATE_STYLE[bill.state]}`}>{bill.state}</span>
                  <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {openId && <BillPanel billId={openId} clinicName={clinicName} isAdmin={isAdmin} onClose={() => setOpenId(null)} onChanged={() => void load()} />}
      {creating && (
        <NewBill
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); setOpenId(id); void load(); }}
        />
      )}
    </div>
  );
}

type Line = { kind: ChargeKind; description: string; quantity: string; unitPrice: string };
const emptyLine = (): Line => ({ kind: 'MEDICINE', description: '', quantity: '1', unitPrice: '' });

/** A bill without a visit: medicine sold over the counter, a lab test on its own, a procedure. */
function NewBill({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [search, setSearch] = useState('');
  const [patient, setPatient] = useState<Patient | null>(null);
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const clinicId = JSON.parse(localStorage.getItem('user') || '{}').clinicId;
    fetch(`${API}/patients/${clinicId}`, { headers: headers() })
      .then((r) => r.json())
      .then((data) => data.success && setPatients(data.patients))
      .catch(() => setError('Could not load your patients - please try again.'));
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return patients.filter((p) => p.name.toLowerCase().includes(q) || p.phone.replace(/\s/g, '').includes(q.replace(/\s/g, ''))).slice(0, 6);
  }, [patients, search]);

  const total = lines.reduce((sum, l) => sum + (parseShillings(l.unitPrice) ?? 0) * (Number(l.quantity) || 0), 0);
  const setLine = (i: number, change: Partial<Line>) => setLines((all) => all.map((l, n) => (n === i ? { ...l, ...change } : l)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patient) return setError('Choose the patient');
    const items = [];
    for (const l of lines) {
      if (!l.description.trim() && !l.unitPrice) continue;
      const price = parseShillings(l.unitPrice);
      const quantity = Number(l.quantity);
      if (!l.description.trim()) return setError('Describe each charge');
      if (!price) return setError(`Enter the price for ${l.description.trim()}, in whole shillings`);
      if (!Number.isInteger(quantity) || quantity < 1) return setError(`The quantity for ${l.description.trim()} must be 1 or more`);
      items.push({ kind: l.kind, description: l.description.trim(), quantity, unitPrice: price });
    }
    if (!items.length) return setError('Add at least one charge');
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API}/invoices`, { method: 'POST', headers: headers(true), body: JSON.stringify({ patientId: patient.id, items }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not open the bill');
      onCreated(data.invoice.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" tabIndex={-1} className="absolute inset-0 bg-slate-950/40" onClick={onClose} />
      <section role="dialog" aria-modal="true" aria-labelledby="new-bill-title" className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-2xl dark:bg-slate-900">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 id="new-bill-title" className="text-lg font-semibold">New bill</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">For charges outside a visit, such as medicine sold over the counter. A visit&apos;s own bill opens when its fee is recorded.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="size-5" aria-hidden="true" /></button>
        </header>
        <form onSubmit={submit} className="space-y-5 px-5 py-5">
          {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
          <div>
            <Label htmlFor="bill-patient">Patient</Label>
            {patient ? (
              <div className="mt-1 flex items-center justify-between rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-800 dark:bg-emerald-950/30">
                <span><strong>{patient.name}</strong> · {patient.phone}</span>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPatient(null)}>Change</Button>
              </div>
            ) : (
              <>
                <Input id="bill-patient" autoFocus placeholder="Type a name or phone number" value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off" />
                {matches.length > 0 && (
                  <ul className="mt-1 divide-y divide-slate-100 rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-700" aria-label="Matching patients">
                    {matches.map((p) => (
                      <li key={p.id}>
                        <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800" onClick={() => { setPatient(p); setSearch(''); }}>
                          {p.name} <span className="text-slate-500">· {p.phone}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {search.trim() && matches.length === 0 && <p className="mt-1 text-xs text-slate-500">No patient matches. Register them under Patients first.</p>}
              </>
            )}
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Charges</legend>
            {lines.map((line, i) => (
              <div key={i} className="grid grid-cols-6 gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <div className="col-span-6 sm:col-span-2">
                  <Label htmlFor={`kind-${i}`} className="text-xs">For</Label>
                  <Select id={`kind-${i}`} value={line.kind} onChange={(e) => setLine(i, { kind: e.target.value as ChargeKind })}>
                    {CHARGE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </Select>
                </div>
                <div className="col-span-6 sm:col-span-4">
                  <Label htmlFor={`description-${i}`} className="text-xs">Description</Label>
                  <Input id={`description-${i}`} value={line.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="e.g. Paracetamol 500 mg" />
                </div>
                <div className="col-span-2">
                  <Label htmlFor={`quantity-${i}`} className="text-xs">Quantity</Label>
                  <Input id={`quantity-${i}`} inputMode="numeric" value={line.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                </div>
                <div className="col-span-3">
                  <Label htmlFor={`price-${i}`} className="text-xs">Price each (UGX)</Label>
                  <Input id={`price-${i}`} inputMode="numeric" value={line.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} />
                </div>
                <div className="col-span-1 flex items-end justify-end">
                  {lines.length > 1 && (
                    <button type="button" aria-label={`Remove charge ${i + 1}`} onClick={() => setLines((all) => all.filter((_, n) => n !== i))} className="rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40">
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((all) => [...all, emptyLine()])}><Plus className="size-4" aria-hidden="true" />Another charge</Button>
          </fieldset>

          <div className="flex items-center justify-between border-t border-slate-200 pt-4 dark:border-slate-800">
            <p className="text-sm">Total <strong className="ml-1 text-lg tabular-nums">{ugx(total)}</strong></p>
            <Button type="submit" disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}Open the bill</Button>
          </div>
        </form>
      </section>
    </div>
  );
}
