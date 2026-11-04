'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { REMOVAL_REASONS, STOCK_UNITS, countDifference, signed, wholeNumber } from '@/lib/stock';
import { shortDate, shortTime } from '@/lib/finance';

export type StockItem = {
  id: string; name: string; quantity: number; unit: string; reorderLevel: number; price: number;
  expiryDate?: string | null; expiredQuantity?: number;
};
export type StockMode = 'receive' | 'remove' | 'count' | 'edit' | 'history';

type Movement = {
  id: string; kind: string; label: string; change: number; balanceAfter: number; reasonLabel: string | null; note: string | null;
  supplier: string | null; reference: string | null; expiryDate: string | null; by: string | null; at: string;
};
type Batch = { id: string; quantity: number; expiryDate: string | null; receivedAt: string; supplier: string | null; expired: boolean };

const API = process.env.NEXT_PUBLIC_API_URL;
const TITLES: Record<StockMode, string> = {
  receive: 'Receive stock', remove: 'Remove stock', count: 'Record a stock count', edit: 'Edit details', history: 'Stock history',
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

/**
 * One stock item's changes and history, in a panel at the side. Every change
 * is recorded on the server with who made it, so each form asks for what an
 * auditor would want to know: the supplier, the reason, what was counted.
 */
export function StockPanel({ item, mode, canChange, onClose, onChanged }: {
  item: StockItem; mode: StockMode; canChange: boolean; onClose: () => void; onChanged: (medicine: StockItem) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);

  // Receive
  const [quantity, setQuantity] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [supplier, setSupplier] = useState('');
  const [reference, setReference] = useState('');
  const [unitCost, setUnitCost] = useState('');
  // Remove
  const [reason, setReason] = useState(item.expiredQuantity ? 'EXPIRED' : '');
  // Count
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  // Edit
  const [details, setDetails] = useState({ name: item.name, unit: item.unit, reorderLevel: String(item.reorderLevel), price: String(item.price) });
  // History
  const [history, setHistory] = useState<{ movements: Movement[]; batches: Batch[] } | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (mode !== 'history') return;
    call(`/inventory/${item.id}/history`).then((d) => setHistory({ movements: d.movements, batches: d.batches })).catch((e) => setError(e.message));
  }, [mode, item.id]);

  useEffect(() => {
    if (mode === 'remove' && reason === 'EXPIRED' && item.expiredQuantity) setQuantity(String(item.expiredQuantity));
  }, [mode, reason, item.expiredQuantity]);

  const send = async (path: string, body: object, method = 'POST') => {
    setBusy(true);
    setError('');
    try {
      const data = await call(path, { method, body: JSON.stringify(body) });
      onChanged(data.medicine);
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'receive') {
      const n = wholeNumber(quantity, 1);
      if (!n) return setError('Enter the quantity received - a whole number, 1 or more');
      return send(`/inventory/${item.id}/receive`, { quantity: n, expiryDate: expiryDate || undefined, supplier, reference, unitCost: unitCost ? wholeNumber(unitCost) ?? unitCost : undefined, note: note || undefined });
    }
    if (mode === 'remove') {
      const n = wholeNumber(quantity, 1);
      if (!reason) return setError('Choose why the stock is being removed');
      if (!n) return setError('Enter the quantity removed - a whole number, 1 or more');
      if (n > item.quantity) return setError(`Only ${item.quantity} ${item.unit} are on the shelf`);
      if (reason === 'OTHER' && !note.trim()) return setError('Say why the stock is being removed');
      return send(`/inventory/${item.id}/remove`, { quantity: n, reason, note: note || undefined });
    }
    if (mode === 'count') {
      const n = wholeNumber(counted);
      if (n === null) return setError('Enter what you counted - a whole number, 0 or more');
      if (n !== item.quantity && !note.trim()) return setError('Say why the count differs (for example: miscounted earlier, found more in the store)');
      return send(`/inventory/${item.id}/count`, { counted: n, note: note || undefined });
    }
    if (mode === 'edit') {
      const reorderLevel = wholeNumber(details.reorderLevel);
      const price = wholeNumber(details.price);
      if (!details.name.trim()) return setError('Enter the name');
      if (reorderLevel === null) return setError('The reorder level must be a whole number, 0 or more');
      if (price === null) return setError('The price must be a whole number of shillings, 0 or more');
      return send(`/inventory/${item.id}`, { name: details.name.trim(), unit: details.unit, reorderLevel, price }, 'PATCH');
    }
  };

  const countValue = wholeNumber(counted);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" tabIndex={-1} className="absolute inset-0 bg-slate-950/40" onClick={onClose} />
      <section role="dialog" aria-modal="true" aria-labelledby="stock-panel-title" className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white shadow-2xl dark:bg-slate-900">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 id="stock-panel-title" className="text-lg font-semibold">{TITLES[mode]}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {item.name} · {item.quantity.toLocaleString('en-US')} {item.unit} on the shelf
            </p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="size-5" aria-hidden="true" /></button>
        </header>

        <div className="space-y-4 px-5 py-5">
          {error && (
            <p role="alert" className="flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}
            </p>
          )}

          {mode === 'history' ? (
            <HistoryView history={history} unit={item.unit} />
          ) : !canChange ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">Only pharmacists and administrators change stock.</p>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {mode === 'receive' && (
                <>
                  <p className="text-sm text-slate-600 dark:text-slate-400">A delivery goes on the shelf as its own batch, with its own expiry date. The batch that expires first is always used first.</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field id="receive-quantity" label={`Quantity received (${item.unit})`}><Input id="receive-quantity" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field>
                    <Field id="receive-expiry" label="Expiry date of this batch"><Input id="receive-expiry" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} /></Field>
                    <Field id="receive-supplier" label="Supplier (optional)"><Input id="receive-supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g. Joint Medical Store" maxLength={80} /></Field>
                    <Field id="receive-reference" label="Delivery note or invoice no. (optional)"><Input id="receive-reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} /></Field>
                    <Field id="receive-cost" label="Cost per unit, UGX (optional)"><Input id="receive-cost" inputMode="numeric" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} /></Field>
                  </div>
                </>
              )}

              {mode === 'remove' && (
                <>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    For stock leaving the shelf other than to a patient.
                    {item.expiredQuantity ? ` ${item.expiredQuantity} ${item.unit} have expired - Bulamu will not dispense or sell them.` : ''}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field id="remove-reason" label="Why">
                      <Select id="remove-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
                        <option value="">Choose...</option>
                        {REMOVAL_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </Select>
                    </Field>
                    <Field id="remove-quantity" label={`Quantity removed (${item.unit})`}><Input id="remove-quantity" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field>
                  </div>
                  <Field id="remove-note" label={reason === 'OTHER' ? 'What happened' : 'Note (optional)'}><Input id="remove-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></Field>
                </>
              )}

              {mode === 'count' && (
                <>
                  <p className="text-sm text-slate-600 dark:text-slate-400">Count what is actually on the shelf. A difference from the record is kept in the history with your reason.</p>
                  <Field id="count-counted" label={`Counted (${item.unit})`}><Input id="count-counted" inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value)} /></Field>
                  {countValue !== null && <p className="text-sm text-slate-700 dark:text-slate-300" role="status">{countDifference(countValue, item.quantity, item.unit)}</p>}
                  <Field id="count-note" label={countValue !== null && countValue !== item.quantity ? 'Why it differs' : 'Note (optional)'}>
                    <Input id="count-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
                  </Field>
                </>
              )}

              {mode === 'edit' && (
                <>
                  <p className="text-sm text-slate-600 dark:text-slate-400">The quantity changes only by receiving, removing or counting stock.</p>
                  <Field id="edit-name" label="Name"><Input id="edit-name" value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} maxLength={120} required /></Field>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field id="edit-unit" label="Unit">
                      <Select id="edit-unit" value={details.unit} onChange={(e) => setDetails({ ...details, unit: e.target.value })}>
                        {[...new Set([details.unit, ...STOCK_UNITS])].map((u) => <option key={u} value={u}>{u}</option>)}
                      </Select>
                    </Field>
                    <Field id="edit-reorder" label="Reorder level"><Input id="edit-reorder" inputMode="numeric" value={details.reorderLevel} onChange={(e) => setDetails({ ...details, reorderLevel: e.target.value })} /></Field>
                    <Field id="edit-price" label="Price (UGX)"><Input id="edit-price" inputMode="numeric" value={details.price} onChange={(e) => setDetails({ ...details, price: e.target.value })} /></Field>
                  </div>
                </>
              )}

              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {mode === 'receive' ? 'Add to stock' : mode === 'remove' ? 'Remove from stock' : mode === 'count' ? 'Record the count' : 'Save'}
              </Button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label htmlFor={id} className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function HistoryView({ history, unit }: { history: { movements: Movement[]; batches: Batch[] } | null; unit: string }) {
  if (!history) return <p className="text-sm text-slate-500"><Loader2 className="mr-2 inline size-4 animate-spin" aria-hidden="true" />Loading...</p>;
  return (
    <>
      <section aria-labelledby="batches-title">
        <h3 id="batches-title" className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">On the shelf, by batch</h3>
        {history.batches.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Nothing on the shelf.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {history.batches.map((b) => (
              <li key={b.id} className="flex items-baseline justify-between gap-3 py-1.5">
                <span>
                  {b.expiryDate ? `Expires ${shortDate(b.expiryDate)}` : 'No expiry date'}
                  {b.expired && <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">Expired</span>}
                  <span className="block text-xs text-slate-500">Received {shortDate(b.receivedAt)}{b.supplier ? ` from ${b.supplier}` : ''}</span>
                </span>
                <span className="shrink-0 tabular-nums">{b.quantity.toLocaleString('en-US')} {unit}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="movements-title">
        <h3 id="movements-title" className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Every change, newest first</h3>
        <ul className="mt-2 divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {history.movements.map((m) => (
            <li key={m.id} className="flex items-start justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="font-medium">{m.label}</span>
                {m.reasonLabel && <> - {m.reasonLabel}</>}
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  {shortDate(m.at)} {shortTime(m.at)}{m.by ? ` · ${m.by}` : ''}
                  {m.supplier ? ` · from ${m.supplier}` : ''}{m.reference ? ` · ${m.reference}` : ''}
                  {m.kind === 'RECEIVED' && m.expiryDate ? ` · expires ${shortDate(m.expiryDate)}` : ''}
                </span>
                {m.note && <span className="block text-xs italic text-slate-600 dark:text-slate-400">{m.note}</span>}
              </span>
              <span className="shrink-0 text-right tabular-nums">
                <span className={m.change > 0 ? 'text-emerald-700 dark:text-emerald-400' : m.change < 0 ? 'text-red-700 dark:text-red-400' : ''}>{signed(m.change)}</span>
                <span className="block text-xs text-slate-500">leaves {m.balanceAfter.toLocaleString('en-US')}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
