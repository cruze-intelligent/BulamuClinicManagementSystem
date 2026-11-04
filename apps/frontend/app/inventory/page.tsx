'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Ban, ClipboardCheck, History, Minus, PackagePlus, Pencil, Plus, Search, XCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  listLocalInventory, addMedicineOffline, replaceInventory, cacheInventory, getCurrentClinicId, subscribeToLocalChanges, LocalMedicine,
} from '@/lib/local-first';
import { MEDICINES_CATALOG } from '@/lib/medicines-catalog';
import { useAuth } from '@/lib/useAuth';
import { shortDate } from '@/lib/finance';
import { STOCK_ROLES, STOCK_UNITS, matchesFilter, stockState, wholeNumber, type StockFilter } from '@/lib/stock';
import { StockPanel, type StockItem, type StockMode } from '@/components/stock-panel';

// Generic name, strength and form - e.g. "Amoxicillin 500 mg capsule".
const CATALOG_STOCK_NAMES = MEDICINES_CATALOG.flatMap((m) => m.variants.map((v) => `${m.name} ${v.strength} ${v.form}`));
const API = process.env.NEXT_PUBLIC_API_URL;

const FILTERS: Array<[StockFilter, string]> = [['all', 'All'], ['low', 'Low or out'], ['expiring', 'Expiring soon'], ['expired', 'Holding expired stock']];
const emptyForm = { name: '', quantity: '', unit: 'tablets', reorderLevel: '', price: '', expiryDate: '' };

export default function InventoryPage() {
  const { hasRole } = useAuth();
  const canChange = hasRole(...STOCK_ROLES);
  const [medicines, setMedicines] = useState<LocalMedicine[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StockFilter>('all');
  const [panel, setPanel] = useState<{ item: StockItem; mode: StockMode } | null>(null);
  const [notice, setNotice] = useState('');

  const loadInventory = useCallback(async () => {
    const clinicId = getCurrentClinicId();
    if (!clinicId) return;
    setMedicines(await listLocalInventory(clinicId));
    setLoading(false);
    if (!navigator.onLine) return;
    try {
      const res = await fetch(`${API}/inventory/${clinicId}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      const data = await res.json();
      if (data.success && Array.isArray(data.medicines)) {
        await replaceInventory(clinicId, data.medicines);
        setMedicines(await listLocalInventory(clinicId));
      }
    } catch (err) {
      console.warn('Inventory fetch failed, using local stock:', err);
    }
  }, []);

  useEffect(() => {
    void loadInventory();
    const unsubscribe = subscribeToLocalChanges(() => void loadInventory());
    return () => unsubscribe();
  }, [loadInventory]);

  const addMedicine = async (e: React.FormEvent) => {
    e.preventDefault();
    const quantity = wholeNumber(form.quantity);
    const reorderLevel = wholeNumber(form.reorderLevel || '0');
    const price = wholeNumber(form.price || '0');
    if (!form.name.trim()) return setFormError('Enter the name of the medicine or item');
    if (quantity === null) return setFormError('The quantity on the shelf must be a whole number, 0 or more');
    if (reorderLevel === null) return setFormError('The reorder level must be a whole number, 0 or more');
    if (price === null) return setFormError('The price must be a whole number of shillings, 0 or more');
    if (form.expiryDate && new Date(form.expiryDate).getTime() <= Date.now()) return setFormError('That expiry date has already passed - expired stock should not go on the shelf');
    try {
      await addMedicineOffline({
        clinicId: getCurrentClinicId() || '', name: form.name.trim(), quantity, unit: form.unit, reorderLevel, price, expiryDate: form.expiryDate || undefined,
      });
      setShowForm(false);
      setForm(emptyForm);
      setFormError('');
      void loadInventory();
    } catch (error: any) {
      setFormError(error.message || 'The item could not be added');
    }
  };

  const discontinue = async (item: LocalMedicine) => {
    if (!navigator.onLine) return setNotice('Discontinuing an item needs a connection, so it is recorded at once.');
    const note = window.prompt(`Take ${item.name} off the stock list? Its history is kept.${item.quantity > 0 ? `\n\n${item.quantity} ${item.unit} are still on the shelf - remove them first if they are leaving.` : ''}\n\nReason (optional):`);
    if (note === null) return;
    try {
      const res = await fetch(`${API}/inventory/${item.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The item could not be discontinued');
      await cacheInventory([{ ...item, deletedAt: new Date().toISOString() }]);
      setNotice(`${item.name} is off the stock list.`);
    } catch (error: any) {
      setNotice(error.message);
    }
  };

  const openPanel = (item: LocalMedicine, mode: StockMode) => {
    if (mode !== 'history' && !navigator.onLine) return setNotice('Stock changes need a connection, so each one is recorded at once.');
    setNotice('');
    setPanel({ item, mode });
  };

  const now = useMemo(() => new Date(), [medicines]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([f]) => [f, medicines.filter((m) => matchesFilter(m, f, '', now)).length])), [medicines, now]);
  const shown = medicines.filter((m) => matchesFilter(m, filter, search, now));

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8 dark:bg-slate-950">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-200">Pharmacy & Inventory</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
              Medicines and supplies on the shelf. Every delivery, dispense, sale, removal and count is recorded with who made it.
              {!canChange && ' Only pharmacists and administrators change stock.'}
            </p>
          </div>
          {canChange && (
            <Button onClick={() => { setShowForm((v) => !v); setFormError(''); }}>
              {showForm ? 'Cancel' : <><Plus className="size-4" aria-hidden="true" />Add an item</>}
            </Button>
          )}
        </div>

        {showForm && canChange && (
          <Card className="mb-6 p-6">
            <form onSubmit={addMedicine} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {formError && (
                <p role="alert" className="flex items-start gap-1.5 text-sm text-red-700 sm:col-span-2 dark:text-red-400"><XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{formError}</p>
              )}
              <div className="sm:col-span-2">
                <Label htmlFor="name">Medicine or item</Label>
                <Input id="name" list="medicine-catalog" autoComplete="off" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Start typing, e.g. Artemether/Lumefantrine" maxLength={120} required />
                {/* The same names prescribers pick from, so stock and prescriptions match. */}
                <datalist id="medicine-catalog">
                  {CATALOG_STOCK_NAMES.map((name) => <option key={name} value={name} />)}
                </datalist>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Choose from the list where you can, so it matches what clinicians prescribe.</p>
              </div>
              <div>
                <Label htmlFor="quantity">On the shelf now</Label>
                <Input id="quantity" inputMode="numeric" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required />
              </div>
              <div>
                <Label htmlFor="unit">Counted in</Label>
                <Select id="unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                  {STOCK_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="reorderLevel">Reorder when down to</Label>
                <Input id="reorderLevel" inputMode="numeric" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} required />
              </div>
              <div>
                <Label htmlFor="price">Price each (UGX)</Label>
                <Input id="price" inputMode="numeric" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
              </div>
              <div>
                <Label htmlFor="expiryDate">Expiry date</Label>
                <Input id="expiryDate" type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Later deliveries are received as their own batches, each with its own date.</p>
              </div>
              <div className="flex items-end">
                <Button type="submit" className="w-full sm:w-auto">Add to stock (works offline)</Button>
              </div>
            </form>
          </Card>
        )}

        {notice && (
          <div role="status" className="mb-4 flex items-start justify-between gap-3 rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm dark:border-slate-800 dark:bg-slate-900">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice('')} className="shrink-0 text-xs font-medium underline">Dismiss</button>
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400" aria-hidden="true" />
            <Input aria-label="Search stock" placeholder="Search stock" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
          </div>
          <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
            {FILTERS.map(([value, label]) => (
              <button
                key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}
                className={`rounded-full border px-3 py-1 text-sm ${filter === value ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'}`}
              >
                {label}{value !== 'all' && counts[value] ? ` (${counts[value]})` : ''}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="text-slate-500 dark:text-slate-400">Loading stock levels...</p>
        ) : medicines.length === 0 ? (
          <Card className="p-8 text-center text-slate-500 dark:text-slate-400">
            No stock items yet.{canChange ? ' Add your first item above - it works offline too.' : ''}
          </Card>
        ) : shown.length === 0 ? (
          <Card className="p-8 text-center text-slate-500 dark:text-slate-400">Nothing matches.</Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((med) => {
              const state = stockState(med, now);
              return (
                <Card key={med.id} className="gap-3 p-4" data-testid="stock-item">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-bold text-slate-800 dark:text-slate-200">{med.name}</h2>
                    {med.syncStatus === 'pending' && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Not sent yet</span>}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    <dt className="text-slate-500 dark:text-slate-400">On the shelf</dt>
                    <dd className={`text-right font-semibold tabular-nums ${state.out || state.low ? 'text-rose-600' : 'text-slate-800 dark:text-slate-200'}`}>{med.quantity.toLocaleString('en-US')} {med.unit}</dd>
                    <dt className="text-slate-500 dark:text-slate-400">Reorder at</dt>
                    <dd className="text-right tabular-nums">{med.reorderLevel.toLocaleString('en-US')}</dd>
                    <dt className="text-slate-500 dark:text-slate-400">Price</dt>
                    <dd className="text-right tabular-nums">UGX {Math.round(med.price).toLocaleString('en-US')}</dd>
                    {med.expiryDate && med.quantity > 0 && (
                      <>
                        <dt className="text-slate-500 dark:text-slate-400">Soonest expiry</dt>
                        <dd className={`text-right ${state.expired || state.expiringSoon ? 'font-semibold text-amber-700 dark:text-amber-400' : ''}`}>{shortDate(med.expiryDate)}</dd>
                      </>
                    )}
                  </dl>

                  {state.expired > 0 && (
                    <Warning tone="red">{state.expired.toLocaleString('en-US')} {med.unit} have expired - they will not be dispensed or sold.{canChange ? ' Remove them from stock.' : ''}</Warning>
                  )}
                  {state.out ? <Warning tone="red">Out of stock</Warning> : state.low && <Warning tone="red">Low stock - reorder</Warning>}
                  {!state.expired && state.expiringSoon && <Warning tone="amber">Some expires within 60 days</Warning>}

                  <div className="mt-auto flex flex-wrap gap-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
                    {canChange && med.syncStatus !== 'pending' && (
                      <>
                        <Action icon={PackagePlus} label="Receive" onClick={() => openPanel(med, 'receive')} />
                        <Action icon={Minus} label="Remove" onClick={() => openPanel(med, 'remove')} />
                        <Action icon={ClipboardCheck} label="Count" onClick={() => openPanel(med, 'count')} />
                        <Action icon={Pencil} label="Edit" onClick={() => openPanel(med, 'edit')} />
                      </>
                    )}
                    {med.syncStatus !== 'pending' && <Action icon={History} label="History" onClick={() => openPanel(med, 'history')} />}
                    {canChange && med.syncStatus !== 'pending' && <Action icon={Ban} label="Discontinue" onClick={() => void discontinue(med)} danger />}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {panel && (
        <StockPanel
          item={panel.item} mode={panel.mode} canChange={canChange} onClose={() => setPanel(null)}
          onChanged={async (medicine) => {
            await cacheInventory([medicine as LocalMedicine]);
            void loadInventory();
          }}
        />
      )}
    </div>
  );
}

function Warning({ tone, children }: { tone: 'red' | 'amber'; children: React.ReactNode }) {
  const style = tone === 'red'
    ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-400'
    : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300';
  return (
    <p className={`flex items-start gap-1.5 rounded border p-2 text-xs font-medium ${style}`}>
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{children}
    </p>
  );
}

function Action({ icon: Icon, label, onClick, danger }: { icon: typeof Plus; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button" onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium ${danger ? 'border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/40' : 'border-slate-200 text-slate-700 hover:border-emerald-500 hover:text-emerald-800 dark:border-slate-700 dark:text-slate-300'}`}
    >
      <Icon className="size-3.5" aria-hidden="true" />{label}
    </button>
  );
}
