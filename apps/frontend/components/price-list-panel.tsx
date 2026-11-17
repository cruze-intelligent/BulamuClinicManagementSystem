'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { parseShillings, ugx, type ChargeKind } from '@/lib/finance';
import { PRICED_KINDS, suggestedServices, usePriceList, type ServicePrice } from '@/lib/price-list';

const API = process.env.NEXT_PUBLIC_API_URL;

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || "That didn't work - please try again.");
  return data;
}

/**
 * The facility's price list, opened from the Bills page: what it charges for
 * consultations, lab tests, imaging, procedures, ward nights and other
 * services. The administrator adds and changes prices; everyone who bills sees
 * them, and a charge picked from the list on a bill is priced for them.
 */
export function PriceListPanel({ isAdmin, onClose }: { isAdmin: boolean; onClose: () => void }) {
  const { prices, reload, clinicId } = usePriceList();
  const [kind, setKind] = useState<ChargeKind>('CONSULTATION');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [editing, setEditing] = useState<{ id: string; price: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const listedNames = useMemo(() => new Set(prices.filter((p) => p.kind === kind).map((p) => p.name.toLowerCase())), [prices, kind]);
  const options = suggestedServices(kind).filter((s) => !listedNames.has(s.toLowerCase()));

  const save = async (payload: { id?: string; kind: ChargeKind; name: string; price: number }, key: string, message: string) => {
    if (!navigator.onLine) return setError('You are offline - prices can be changed when the connection returns.');
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await call(`/clinics/${clinicId}/price-list`, { method: 'PUT', body: JSON.stringify(payload) });
      await reload();
      setNotice(message);
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseShillings(price);
    if (!name.trim()) return setError('Name the service, for example "General consultation"');
    if (!amount) return setError('Enter the price, in whole shillings');
    const existing = prices.find((p) => p.kind === kind && p.name.toLowerCase() === name.trim().toLowerCase());
    if (await save({ kind, name: name.trim(), price: amount }, 'add', existing ? `${name.trim()} is now ${ugx(amount)} (was ${ugx(existing.price)}).` : `${name.trim()} added at ${ugx(amount)}.`)) {
      setName('');
      setPrice('');
    }
  };

  const change = async (item: ServicePrice) => {
    const amount = parseShillings(editing?.price ?? '');
    if (!amount) return setError(`Enter the price for ${item.name}, in whole shillings`);
    if (await save({ id: item.id, kind: item.kind, name: item.name, price: amount }, item.id, `${item.name} is now ${ugx(amount)}.`)) setEditing(null);
  };

  const remove = async (item: ServicePrice) => {
    if (!window.confirm(`Take ${item.name} (${ugx(item.price)}) off the price list? Bills already raised keep their prices.`)) return;
    setBusy(item.id);
    setError('');
    try {
      await call(`/clinics/${clinicId}/price-list/${item.id}`, { method: 'DELETE' });
      await reload();
      setNotice(`${item.name} taken off the list.`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close the price list" className="absolute inset-0 bg-slate-950/40" onClick={onClose} tabIndex={-1} />
      <section role="dialog" aria-modal="true" aria-labelledby="price-list-title" className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-2xl dark:bg-slate-900">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="min-w-0">
            <h2 id="price-list-title" className="text-lg font-semibold text-slate-950 dark:text-slate-50">Price list</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              What your facility charges. A charge picked from this list on a bill is priced for you. Medicines are priced in Inventory, with each stock item.
            </p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 space-y-6 px-5 py-5">
          {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
          {notice && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">{notice}</p>}

          {isAdmin ? (
            <form onSubmit={add} className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-6 dark:border-slate-800">
              <div className="sm:col-span-2">
                <Label htmlFor="price-kind" className="text-xs">For</Label>
                <Select id="price-kind" value={kind} onChange={(e) => setKind(e.target.value as ChargeKind)}>
                  {PRICED_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </Select>
              </div>
              <div className="sm:col-span-4">
                <Label htmlFor="price-name" className="text-xs">Service</Label>
                <Input id="price-name" list="price-name-options" value={name} onChange={(e) => setName(e.target.value)} placeholder="Choose or type the service" autoComplete="off" maxLength={120} />
                <datalist id="price-name-options">{options.map((o) => <option key={o} value={o} />)}</datalist>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{PRICED_KINDS.find((k) => k.value === kind)?.hint}</p>
              </div>
              <div className="sm:col-span-3">
                <Label htmlFor="price-amount" className="text-xs">Price (UGX)</Label>
                <Input id="price-amount" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 10,000" />
              </div>
              <div className="flex items-end sm:col-span-3">
                <Button type="submit" disabled={busy === 'add'} className="w-full sm:w-auto">
                  {busy === 'add' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}Add to the list
                </Button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">Your facility administrator sets these prices.</p>
          )}

          {prices.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              Nothing on the list yet.{isAdmin ? ' Start with your consultation fees and your most common tests and scans.' : ''}
            </p>
          )}

          {PRICED_KINDS.map((group) => {
            const items = prices.filter((p) => p.kind === group.value);
            if (!items.length) return null;
            return (
              <section key={group.value} aria-labelledby={`prices-${group.value}`}>
                <h3 id={`prices-${group.value}`} className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{group.label}</h3>
                <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
                  {items.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                      <span className="min-w-0 flex-1 basis-[10rem] text-slate-900 dark:text-slate-100">{item.name}</span>
                      {editing?.id === item.id ? (
                        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); void change(item); }}>
                          <Input aria-label={`New price for ${item.name}`} inputMode="numeric" className="h-8 w-28" value={editing.price} onChange={(e) => setEditing({ id: item.id, price: e.target.value })} autoFocus />
                          <Button type="submit" size="sm" variant="ghost" disabled={busy === item.id} aria-label={`Save the price for ${item.name}`}><Check className="size-4" aria-hidden="true" /></Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)} aria-label="Cancel"><X className="size-4" aria-hidden="true" /></Button>
                        </form>
                      ) : (
                        <>
                          <span className="whitespace-nowrap font-medium tabular-nums">{ugx(item.price)}</span>
                          {isAdmin && (
                            <span className="flex">
                              <Button size="sm" variant="ghost" onClick={() => setEditing({ id: item.id, price: String(item.price) })} aria-label={`Change the price of ${item.name}`}><Pencil className="size-4" aria-hidden="true" /></Button>
                              <Button size="sm" variant="ghost" disabled={busy === item.id} onClick={() => void remove(item)} aria-label={`Remove ${item.name}`}><Trash2 className="size-4" aria-hidden="true" /></Button>
                            </span>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/** The listed services of one kind, offered as the description of a charge is typed. */
export function ListedServices({ id, prices, kind }: { id: string; prices: ServicePrice[]; kind: ChargeKind }) {
  return (
    <datalist id={id}>
      {prices.filter((p) => p.kind === kind).map((p) => <option key={p.id} value={p.name}>{ugx(p.price)}</option>)}
    </datalist>
  );
}
