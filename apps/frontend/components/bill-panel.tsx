'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Ban, CheckCircle2, FileDown, Loader2, Mail, MessageCircle, MessageSquareText, Plus, Printer, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { openPdfWithAuth } from '@/lib/download';
import {
  CHARGE_KINDS, PAYMENT_METHODS, REFERENCE_HINTS, kindLabel, methodLabel, parseShillings, receiptMessage, shortDate, shortTime,
  smsLink, ugx, whatsappLink, type ChargeKind, type PaymentMethod,
} from '@/lib/finance';

export type BillItem = { id: string; kind: ChargeKind; description: string; quantity: number; unitPrice: number; amount: number };
export type BillPayment = {
  id: string; receiptNumber: string; amount: number; method: PaymentMethod | null; reference: string | null; payerName: string | null;
  receivedAt: string; receivedBy: { name: string; role: string } | null; voidedAt: string | null; voidReason: string | null;
};
export type Bill = {
  id: string; clinicId: string; consultationId: string | null; amount: number; amountPaid: number; balance: number;
  status: 'PENDING' | 'PAID' | 'CANCELLED'; state: 'Unpaid' | 'Part paid' | 'Paid' | 'Cancelled'; createdAt: string; paidAt: string | null;
  patient: { id: string; name: string; phone: string; email: string | null };
  consultation: { id: string; diagnosis: string; appointment: { doctor: { name: string } | null } } | null;
  items: BillItem[]; payments: BillPayment[];
};
type Suggestion = { kind: ChargeKind; description: string; quantity: number; unitPrice: number | null; labTestId?: string; prescriptionId?: string; admissionId?: string };

export const STATE_STYLE: Record<Bill['state'], string> = {
  Unpaid: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
  'Part paid': 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-300',
  Paid: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  Cancelled: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
};

const API = process.env.NEXT_PUBLIC_API_URL;
const token = () => (typeof window === 'undefined' ? null : localStorage.getItem('token'));
async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token()}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || "That didn't work - please try again.");
  return data;
}

/**
 * One bill, opened from the list: its lines (with what the visit could still
 * add), the payments taken and their receipts, and taking the next payment.
 * Shown as a side panel on a computer and full screen on a phone.
 */
export function BillPanel({
  billId, clinicName, isAdmin, onClose, onChanged,
}: { billId: string; clinicName: string; isAdmin: boolean; onClose: () => void; onChanged: () => void }) {
  const [bill, setBill] = useState<Bill | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [justPaid, setJustPaid] = useState<BillPayment | null>(null);
  const [notice, setNotice] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  // Record a payment received
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [reference, setReference] = useState('');
  const [payerName, setPayerName] = useState('');
  const [otherPayer, setOtherPayer] = useState(false);

  // Add a charge
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<ChargeKind>('LAB');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await call(`/invoices/detail/${billId}`);
      setBill(data.invoice);
      setSuggestions(data.suggestions);
      setPrices(Object.fromEntries(data.suggestions.map((s: Suggestion, i: number) => [i, s.unitPrice ? String(s.unitPrice) : ''])));
      setAmount(data.invoice.balance > 0 ? String(data.invoice.balance) : '');
    } catch (err: any) {
      setError(err.message);
    }
  }, [billId]);

  useEffect(() => {
    void load();
    closeRef.current?.focus();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (key: string, action: () => Promise<any>, after?: (data: any) => void) => {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      const data = await action();
      if (data?.invoice) {
        setBill(data.invoice);
        setAmount(data.invoice.balance > 0 ? String(data.invoice.balance) : '');
      }
      after?.(data);
      onChanged();
      if (!data?.invoice || data?.reload) await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const addCharge = (charge: Omit<Suggestion, 'unitPrice'> & { unitPrice: number }, key: string) =>
    run(key, () => call(`/invoices/${billId}/items`, { method: 'POST', body: JSON.stringify(charge) }), () => load());

  const takePayment = (e: React.FormEvent) => {
    e.preventDefault();
    const value = parseShillings(amount);
    if (!value) return setError('Enter the amount received, in whole shillings');
    void run('pay', () => call(`/invoices/${billId}/payments`, {
      method: 'POST',
      body: JSON.stringify({ amount: value, method, reference: reference.trim() || undefined, payerName: otherPayer ? payerName.trim() || undefined : undefined }),
    }), (data) => {
      setJustPaid(data.payment);
      // The receipt options are at the top of the panel - bring them into view.
      panelRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      setReference('');
      setPayerName('');
      setOtherPayer(false);
    });
  };

  const openReceipt = (payment: BillPayment) =>
    openPdfWithAuth(`${API}/payments/${payment.id}/receipt/pdf`, token(), `receipt-${payment.receiptNumber}.pdf`).catch((err) => setError(err.message));

  const emailReceipt = (payment: BillPayment) => {
    let email = bill?.patient.email ?? '';
    if (!email) {
      email = window.prompt(`Which email address should receipt ${payment.receiptNumber} go to?`)?.trim() ?? '';
      if (!email) return;
    }
    void run(`email-${payment.id}`, () => call(`/payments/${payment.id}/receipt/email`, { method: 'POST', body: JSON.stringify({ email }) }), (data) =>
      setNotice(`Receipt ${payment.receiptNumber} emailed to ${data.to}.`));
  };

  const voidPayment = (payment: BillPayment) => {
    const reason = window.prompt(`Void receipt ${payment.receiptNumber} (${ugx(payment.amount)})? It stays on record marked VOID and stops counting. Say why:`)?.trim();
    if (!reason) return;
    void run(`void-${payment.id}`, () => call(`/payments/${payment.id}/void`, { method: 'POST', body: JSON.stringify({ reason }) }));
  };

  const removeItem = (item: BillItem) => {
    if (!window.confirm(`Take "${item.description}" (${ugx(item.amount)}) off this bill?`)) return;
    void run(`remove-${item.id}`, () => call(`/invoices/${billId}/items/${item.id}`, { method: 'DELETE' }), () => load());
  };

  const cancelBill = () => {
    if (!bill || !window.confirm(`Cancel this ${ugx(bill.amount)} bill? Use this for a bill raised by mistake or waived. It is kept, marked cancelled.`)) return;
    void run('cancel', () => call(`/invoices/${billId}/cancel`, { method: 'PATCH' }), () => load());
  };

  const message = (payment: BillPayment) => receiptMessage({
    clinicName, patientName: bill?.patient.name ?? '', receiptNumber: payment.receiptNumber, amount: payment.amount, method: payment.method,
    receivedAt: payment.receivedAt, balance: bill?.balance ?? 0,
  });

  const open = bill && bill.status !== 'CANCELLED';
  const hint = REFERENCE_HINTS[method];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close the bill" className="absolute inset-0 bg-slate-950/40" onClick={onClose} tabIndex={-1} />
      <section
        ref={panelRef}
        role="dialog" aria-modal="true" aria-labelledby="bill-title"
        className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-2xl dark:bg-slate-900"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="min-w-0">
            <h2 id="bill-title" className="truncate text-lg font-semibold text-slate-950 dark:text-slate-50">{bill?.patient.name ?? 'Bill'}</h2>
            {bill && (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {bill.consultation ? `Visit: ${bill.consultation.diagnosis}` : 'Without a visit'} · {shortDate(bill.createdAt)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {bill && <span className={`whitespace-nowrap rounded px-2 py-1 text-xs font-medium ${STATE_STYLE[bill.state]}`}>{bill.state}</span>}
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-6 px-5 py-5">
          {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
          {notice && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">{notice}</p>}
          {!bill && !error && <p className="text-sm text-slate-500"><Loader2 className="mr-2 inline size-4 animate-spin" aria-hidden="true" />Opening the bill...</p>}

          {bill && justPaid && (
            <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
              <p className="flex items-center gap-2 font-semibold text-emerald-900 dark:text-emerald-200">
                <CheckCircle2 className="size-5" aria-hidden="true" />
                {ugx(justPaid.amount)} received - receipt {justPaid.receiptNumber}
              </p>
              <p className="mt-1 text-sm text-emerald-900/80 dark:text-emerald-200/80">
                {bill.balance > 0 ? `${ugx(bill.balance)} is still owed on this bill.` : 'The bill is paid in full.'} Give the patient their receipt:
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => openReceipt(justPaid)}><Printer className="size-4" aria-hidden="true" />Print receipt</Button>
                <Button size="sm" variant="outline" disabled={busy === `email-${justPaid.id}`} onClick={() => emailReceipt(justPaid)}><Mail className="size-4" aria-hidden="true" />Email</Button>
                <a href={smsLink(bill.patient.phone, message(justPaid))} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800">
                  <MessageSquareText className="size-4" aria-hidden="true" />SMS
                </a>
                <a href={whatsappLink(bill.patient.phone, message(justPaid))} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800">
                  <MessageCircle className="size-4" aria-hidden="true" />WhatsApp
                </a>
              </div>
            </div>
          )}

          {bill && (
            <>
              <section aria-labelledby="bill-lines">
                <h3 id="bill-lines" className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Charges</h3>
                <table className="mt-2 w-full text-sm">
                  <thead className="sr-only"><tr><th>Item</th><th>Amount</th><th>Remove</th></tr></thead>
                  <tbody>
                    {bill.items.map((item) => (
                      <tr key={item.id} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="py-2 pr-2">
                          <span className="block font-medium text-slate-900 dark:text-slate-100">{item.description}</span>
                          <span className="block text-xs text-slate-500 dark:text-slate-400">
                            {[
                              kindLabel(item.kind).toLowerCase() === item.description.toLowerCase() ? '' : kindLabel(item.kind),
                              item.quantity > 1 ? `${item.quantity} × ${item.unitPrice.toLocaleString('en-US')}` : '',
                            ].filter(Boolean).join(' · ')}
                          </span>
                        </td>
                        <td className="whitespace-nowrap py-2 text-right tabular-nums">{item.amount.toLocaleString('en-US')}</td>
                        <td className="w-9 py-2 text-right">
                          {open && bill.items.length > 1 && (
                            <button type="button" onClick={() => removeItem(item)} disabled={!!busy} aria-label={`Remove ${item.description}`} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40">
                              <Trash2 className="size-4" aria-hidden="true" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {bill.items.length === 0 && (
                      <tr><td className="py-2 text-slate-500" colSpan={3}>Consultation (one amount, from before bills were itemised)</td></tr>
                    )}
                  </tbody>
                  <tfoot className="text-sm">
                    <tr><td className="pt-3 font-medium">Total</td><td className="whitespace-nowrap pt-3 text-right font-semibold tabular-nums">{ugx(bill.amount)}</td><td /></tr>
                    <tr><td className="text-slate-500 dark:text-slate-400">Paid</td><td className="whitespace-nowrap text-right tabular-nums text-slate-500 dark:text-slate-400">{ugx(bill.amountPaid)}</td><td /></tr>
                    <tr><td className="font-semibold">Balance</td><td className={`whitespace-nowrap text-right text-lg font-bold tabular-nums ${bill.balance > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{ugx(bill.balance)}</td><td /></tr>
                  </tfoot>
                </table>

                {open && suggestions.length > 0 && (
                  <div className="mt-4 rounded-lg border border-dashed border-slate-300 p-3 dark:border-slate-700">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Not on the bill yet</p>
                    <ul className="mt-2 space-y-2">
                      {suggestions.map((s, i) => (
                        <li key={s.labTestId ?? s.prescriptionId ?? s.admissionId ?? i} className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="min-w-0 flex-1">
                            {s.description}
                            <span className="text-slate-500 dark:text-slate-400"> · {kindLabel(s.kind)}{s.quantity > 1 ? ` × ${s.quantity}` : ''}</span>
                          </span>
                          <Input
                            aria-label={`Price for ${s.description}${s.quantity > 1 ? ', each' : ''}`} inputMode="numeric" placeholder={s.quantity > 1 ? 'Price each' : 'Price'}
                            className="h-8 w-28" value={prices[i] ?? ''} onChange={(e) => setPrices((p) => ({ ...p, [i]: e.target.value }))}
                          />
                          <Button
                            size="sm" variant="outline" disabled={!!busy}
                            onClick={() => {
                              const price = parseShillings(prices[i] ?? '');
                              if (!price) return setError(`Enter the price for ${s.description}`);
                              void addCharge({ ...s, unitPrice: price }, `suggest-${i}`);
                            }}
                          >
                            <Plus className="size-4" aria-hidden="true" />Add
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {open && (adding ? (
                  <form
                    className="mt-4 grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-6 dark:border-slate-800"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const price = parseShillings(unitPrice);
                      const qty = Number(quantity);
                      if (!description.trim()) return setError('Describe the charge');
                      if (!price) return setError('Enter the price, in whole shillings');
                      if (!Number.isInteger(qty) || qty < 1) return setError('The quantity must be 1 or more');
                      void addCharge({ kind, description: description.trim(), quantity: qty, unitPrice: price }, 'add').then(() => {
                        setDescription(''); setUnitPrice(''); setQuantity('1'); setAdding(false);
                      });
                    }}
                  >
                    <div className="sm:col-span-2">
                      <Label htmlFor="charge-kind" className="text-xs">For</Label>
                      <Select id="charge-kind" value={kind} onChange={(e) => setKind(e.target.value as ChargeKind)}>
                        {CHARGE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                      </Select>
                    </div>
                    <div className="sm:col-span-4">
                      <Label htmlFor="charge-description" className="text-xs">Description</Label>
                      <Input id="charge-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Malaria RDT, wound dressing" />
                    </div>
                    <div className="sm:col-span-2">
                      <Label htmlFor="charge-quantity" className="text-xs">Quantity</Label>
                      <Input id="charge-quantity" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                    </div>
                    <div className="sm:col-span-2">
                      <Label htmlFor="charge-price" className="text-xs">Price each (UGX)</Label>
                      <Input id="charge-price" inputMode="numeric" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
                    </div>
                    <div className="flex items-end gap-2 sm:col-span-2">
                      <Button type="submit" size="sm" disabled={!!busy}>Add</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>Close</Button>
                    </div>
                  </form>
                ) : (
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => setAdding(true)}>
                    <Plus className="size-4" aria-hidden="true" />Add a charge
                  </Button>
                ))}
              </section>

              {open && bill.balance > 0 && (
                <section aria-labelledby="take-payment" className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40">
                  <h3 id="take-payment" className="font-semibold text-slate-950 dark:text-slate-50">Record a payment</h3>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Money the facility has received from or for this patient - Bulamu keeps the record and the receipt.</p>
                  <form onSubmit={takePayment} className="mt-3 space-y-3">
                    <fieldset>
                      <legend className="mb-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">Paid by</legend>
                      <div className="flex flex-wrap gap-2">
                        {PAYMENT_METHODS.map((m) => (
                          <label key={m.value} className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm ${method === m.value ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'}`}>
                            <input type="radio" name="method" value={m.value} checked={method === m.value} onChange={() => setMethod(m.value)} className="sr-only" />
                            {m.label}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="pay-amount" className="text-xs">Amount received (UGX)</Label>
                        <Input id="pay-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">The whole balance, or part of it.</p>
                      </div>
                      {hint && (
                        <div>
                          <Label htmlFor="pay-reference" className="text-xs">{hint.label}</Label>
                          <Input id="pay-reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder={hint.placeholder} autoCapitalize="characters" />
                        </div>
                      )}
                    </div>
                    <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                      <input type="checkbox" checked={otherPayer} onChange={(e) => setOtherPayer(e.target.checked)} className="size-4 accent-emerald-600" />
                      Someone else paid (a relative, an employer)
                    </label>
                    {otherPayer && (
                      <div>
                        <Label htmlFor="pay-payer" className="text-xs">Name of the person who paid</Label>
                        <Input id="pay-payer" value={payerName} onChange={(e) => setPayerName(e.target.value)} />
                      </div>
                    )}
                    <Button type="submit" className="w-full sm:w-auto" disabled={busy === 'pay'}>
                      {busy === 'pay' && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                      Record {parseShillings(amount) ? ugx(parseShillings(amount)!) : 'the payment'} received
                    </Button>
                  </form>
                </section>
              )}

              <section aria-labelledby="bill-payments">
                <h3 id="bill-payments" className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Payments and receipts</h3>
                {bill.payments.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Nothing paid yet.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
                    {bill.payments.map((p) => (
                      <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                        <div className={p.voidedAt ? 'text-slate-400 line-through dark:text-slate-500' : ''}>
                          <span className="font-medium">Receipt {p.receiptNumber}</span> · {ugx(p.amount)} · {methodLabel(p.method)}
                          <span className="block text-xs text-slate-500 no-underline dark:text-slate-400">
                            {shortDate(p.receivedAt)} {shortTime(p.receivedAt)}{p.receivedBy ? ` · taken by ${p.receivedBy.name}` : ''}{p.reference ? ` · ${p.reference}` : ''}
                          </span>
                        </div>
                        {p.voidedAt && <span className="rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300" title={p.voidReason ?? undefined}>VOID</span>}
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openReceipt(p)} aria-label={`Print receipt ${p.receiptNumber}`}><Printer className="size-4" aria-hidden="true" /></Button>
                          {!p.voidedAt && (
                            <Button size="sm" variant="ghost" disabled={busy === `email-${p.id}`} onClick={() => emailReceipt(p)} aria-label={`Email receipt ${p.receiptNumber}`}><Mail className="size-4" aria-hidden="true" /></Button>
                          )}
                          {!p.voidedAt && isAdmin && (
                            <Button size="sm" variant="ghost" disabled={busy === `void-${p.id}`} onClick={() => voidPayment(p)} aria-label={`Void receipt ${p.receiptNumber}`}><Ban className="size-4" aria-hidden="true" /></Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
                <Button variant="outline" size="sm" onClick={() => openPdfWithAuth(`${API}/invoices/${bill.id}/pdf`, token(), `invoice-${bill.id.slice(0, 8)}.pdf`).catch((err) => setError(err.message))}>
                  <FileDown className="size-4" aria-hidden="true" />Print the invoice
                </Button>
                {isAdmin && bill.status === 'PENDING' && bill.amountPaid === 0 && (
                  <Button variant="outline" size="sm" disabled={busy === 'cancel'} onClick={cancelBill}>Cancel the bill</Button>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
