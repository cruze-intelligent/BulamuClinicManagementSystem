'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, BedDouble, ClipboardList, Pill, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/useAuth';
import { formatDayTime } from '@/lib/time';

const API = process.env.NEXT_PUBLIC_API_URL;
const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });
type Status = 'GIVEN' | 'REFUSED' | 'WITHHELD' | 'NOT_AVAILABLE';
type Order = {
  id: string; medication: string; strength: string | null; dose: string; route: string | null;
  frequency: string; duration: string | null; instructions: string | null; prescribedByName: string; administrationCount: number;
  stockMedicine: { id: string; name: string; unit: string; price: number } | null;
  admission: { id: string; bed: string | null; ward: { name: string }; patient: { id: string; name: string; allergies: string } };
  administrations: { id: string; status: Status; doseGiven: string | null; administeredAt: string; note: string | null; givenByName: string; stockQuantity: number | null }[];
};
type Inpatient = { id: string; bed: string | null; ward: { name: string }; patient: { id: string; name: string; allergies?: string | null } };

const localDateTime = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const statusLabel: Record<Status, string> = { GIVEN: 'Given', REFUSED: 'Refused', WITHHELD: 'Withheld', NOT_AVAILABLE: 'Not available' };

export default function NursingPage() {
  const { hasRole } = useAuth();
  const canBill = hasRole('ADMIN', 'DOCTOR', 'NURSE', 'STAFF', 'PHARMACIST');
  const [orders, setOrders] = useState<Order[]>([]);
  const [admissions, setAdmissions] = useState<Inpatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Order | null>(null);
  const [openedPatientId, setOpenedPatientId] = useState<string | null>(null);
  const [patientSearch, setPatientSearch] = useState('');
  const [status, setStatus] = useState<Status>('GIVEN');
  const [dose, setDose] = useState('');
  const [stockQuantity, setStockQuantity] = useState('');
  const [route, setRoute] = useState('');
  const [time, setTime] = useState(localDateTime(new Date()));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [medicationResponse, admissionResponse] = await Promise.all([
        fetch(`${API}/nursing/medications`, { headers: headers() }),
        fetch(`${API}/admissions`, { headers: headers() }),
      ]);
      const [data, admissionData] = await Promise.all([medicationResponse.json(), admissionResponse.json()]);
      if (!medicationResponse.ok || !data.success) throw new Error(data.error || 'Could not load the medication chart');
      if (!admissionResponse.ok || !admissionData.success) throw new Error(admissionData.error || 'Could not load admitted patients');
      setOrders(data.orders);
      setAdmissions(admissionData.admissions);
      setError('');
    } catch (error: unknown) {
      setError(navigator.onLine ? (error instanceof Error ? error.message : 'Could not load the medication chart') : 'You are offline. Medication charts need a connection to save safely.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (hasRole('NURSE', 'DOCTOR', 'ADMIN')) void load();
    window.addEventListener('online', load);
    return () => window.removeEventListener('online', load);
  }, [hasRole, load]);

  const patients = useMemo(() => {
    const query = patientSearch.trim().toLocaleLowerCase();
    return admissions.filter((admission) => !query || `${admission.patient.name} ${admission.ward.name} ${admission.bed ?? ''}`.toLocaleLowerCase().includes(query));
  }, [admissions, patientSearch]);
  const patientCount = admissions.length;

  const openRecord = (order: Order) => {
    setSelected(order); setStatus('GIVEN'); setDose(order.dose); setRoute(order.route ?? ''); setStockQuantity('');
    setTime(localDateTime(new Date())); setNote(''); setMessage('');
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setSaving(true); setMessage('');
    try {
      const response = await fetch(`${API}/admissions/${selected.admission.id}/medication-orders/${selected.id}/administrations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({ status, doseGiven: dose, routeGiven: route || undefined, stockQuantity: status === 'GIVEN' && selected.stockMedicine ? Number(stockQuantity) : undefined, administeredAt: new Date(time).toISOString(), note: note || undefined }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'The treatment record could not be saved');
      setSelected(null); setMessage(data.invoiceId ? 'Treatment recorded, stock deducted and medication added to the patient bill.' : 'Treatment recorded in the patient chart.'); await load();
    } catch (error: unknown) { setMessage(error instanceof Error ? error.message : 'The treatment record could not be saved'); }
    finally { setSaving(false); }
  };

  if (!hasRole('NURSE', 'DOCTOR', 'ADMIN')) return null;

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-emerald-700"><ClipboardList className="size-4" aria-hidden="true" /> Nursing</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Inpatient medication chart</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">Current ward-round orders for admitted patients. Record each dose after care is given, or document why it was not given.</p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh</Button>
      </header>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Medication chart summary">
        <Card className="flex items-center gap-3 p-4"><span className="rounded-lg bg-emerald-50 p-2 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"><Pill className="size-5" aria-hidden="true" /></span><span><span className="block text-xs uppercase text-slate-500">Active orders</span><strong className="text-xl">{orders.length}</strong></span></Card>
        <Card className="flex items-center gap-3 p-4"><span className="rounded-lg bg-sky-50 p-2 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300"><BedDouble className="size-5" aria-hidden="true" /></span><span><span className="block text-xs uppercase text-slate-500">Patients with orders</span><strong className="text-xl">{patientCount}</strong></span></Card>
        <Card className="flex items-center gap-3 p-4"><span className="rounded-lg bg-amber-50 p-2 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"><ClipboardList className="size-5" aria-hidden="true" /></span><span><span className="block text-xs uppercase text-slate-500">Updated</span><strong className="text-sm">{loading ? 'Refreshing…' : 'Live chart'}</strong></span></Card>
      </section>

      {error && <Card role="alert" className="border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{error}</Card>}
      {orders.length > 0 && <section aria-label="Inpatients" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">Patients</h2><p className="text-sm text-slate-500">Open a patient to review their medication chart and administered-dose counts.</p></div><Input aria-label="Find inpatient" className="max-w-sm" placeholder="Search patients, wards or beds" value={patientSearch} onChange={(event) => setPatientSearch(event.target.value)} /></div>
        {patients.map((admission) => { const patientOrders = orders.filter((order) => order.admission.id === admission.id); const expanded = openedPatientId === admission.id; const count = patientOrders.reduce((n, order) => n + order.administrationCount, 0); return <Card key={admission.id} className="overflow-hidden"><button type="button" aria-expanded={expanded} onClick={() => setOpenedPatientId(expanded ? null : admission.id)} className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left hover:bg-slate-50 dark:hover:bg-slate-900"><span><strong className="block">{admission.patient.name}</strong><span className="text-sm text-slate-500">{admission.ward.name}{admission.bed ? ` · Bed ${admission.bed}` : ''}</span></span><span className="text-right text-sm"><strong>{patientOrders.length}</strong><span className="block text-xs text-slate-500">prescriptions · {count} doses given</span></span></button>{expanded && <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4"><p className="text-sm text-slate-500">{patientOrders.length ? 'Medication prescriptions and treatment records for this patient are shown below.' : 'This patient has no active medication prescriptions.'} <Link href={`/wards/admission?id=${admission.id}`} className="underline">Open full chart</Link></p>{canBill && <Link href={`/invoices?q=${encodeURIComponent(admission.patient.name)}`} className="text-sm font-medium text-emerald-800 underline dark:text-emerald-300">Open patient bill</Link>}</div>}</Card>; })}
        {patients.length === 0 && <Card className="p-6 text-center text-sm text-slate-500">No patients match that search.</Card>}
      </section>}
      {message && !selected && <p role="status" className="text-sm text-emerald-800 dark:text-emerald-300">{message}</p>}
      {loading && orders.length === 0 ? <p className="text-sm text-slate-500">Loading medication orders…</p> : orders.length === 0 ? (
        <Card className="p-8 text-center">
          <Pill className="mx-auto size-8 text-slate-400" aria-hidden="true" />
          <h2 className="mt-3 font-semibold">No active inpatient medication orders</h2>
          <p className="mt-1 text-sm text-slate-500">When a doctor adds a ward-round order, it will appear here. You can still review admitted patients from <Link className="underline" href="/wards">Wards</Link>.</p>
        </Card>
      ) : (
        <section className="grid gap-4 lg:grid-cols-2" aria-label="Active medication orders">
          {orders.filter((order) => order.admission.id === openedPatientId).map((order) => {
            const allergy = order.admission.patient.allergies && order.admission.patient.allergies !== 'No known allergies';
            return <Card key={order.id} className="overflow-hidden">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><Link href={`/wards/admission?id=${order.admission.id}`} className="font-semibold hover:underline">{order.admission.patient.name}</Link><p className="text-xs text-slate-500">{order.admission.ward.name}{order.admission.bed ? ` · Bed ${order.admission.bed}` : ''}</p></div>
                  {allergy && <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-800 dark:bg-rose-950/60 dark:text-rose-300"><AlertTriangle className="size-3" aria-hidden="true" /> Allergy alert</span>}
                </div>
                {allergy && <p className="mt-2 text-xs font-medium text-rose-800 dark:text-rose-300">{order.admission.patient.allergies}</p>}
              </div>
              <div className="space-y-3 p-4">
                <div><h2 className="text-lg font-semibold">{order.medication}{order.strength ? ` · ${order.strength}` : ''}</h2><p className="text-sm">{order.dose}{order.route ? ` · ${order.route}` : ''} · {order.frequency}{order.duration ? ` · ${order.duration}` : ''}</p>{order.instructions && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{order.instructions}</p>}<p className="mt-1 text-xs text-slate-500">Prescribed by {order.prescribedByName}</p></div>
                {order.administrations.length > 0 && <div className="rounded-md bg-slate-50 p-3 text-xs dark:bg-slate-900"><p className="mb-1 font-semibold">Recent treatment records</p><ul className="space-y-1">{order.administrations.slice(0, 3).map((entry) => <li key={entry.id}>{formatDayTime(entry.administeredAt)} · {statusLabel[entry.status]}{entry.doseGiven ? ` (${entry.doseGiven})` : ''} · {entry.givenByName}{entry.note ? ` — ${entry.note}` : ''}</li>)}</ul></div>}
                <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">{order.administrationCount} doses administered</p>
                {order.stockMedicine && <p className="text-xs text-emerald-800 dark:text-emerald-300">Linked stock: {order.stockMedicine.name} ({order.stockMedicine.unit}) · UGX {Math.round(order.stockMedicine.price).toLocaleString()} per unit</p>}
                <Button onClick={() => openRecord(order)}>Record treatment</Button>
              </div>
            </Card>;
          })}
        </section>
      )}

      {selected && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setSelected(null); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="treatment-title" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-white p-5 shadow-xl sm:rounded-xl dark:bg-slate-950">
          <h2 id="treatment-title" className="text-xl font-semibold">Record treatment</h2><p className="mt-1 text-sm text-slate-500">{selected.admission.patient.name} · {selected.medication}</p>
          <form onSubmit={save} className="mt-4 space-y-3">
            <div><Label htmlFor="treatment-status">Outcome</Label><Select id="treatment-status" value={status} onChange={(e) => setStatus(e.target.value as Status)}><option value="GIVEN">Given</option><option value="REFUSED">Refused</option><option value="WITHHELD">Withheld</option><option value="NOT_AVAILABLE">Not available</option></Select></div>
            {status === 'GIVEN' && <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="dose-given">Dose given</Label><Input id="dose-given" required value={dose} onChange={(e) => setDose(e.target.value)} /></div><div><Label htmlFor="route-given">How given / route</Label><Input id="route-given" value={route} onChange={(e) => setRoute(e.target.value)} placeholder="e.g. oral, IV, IM" /></div></div>}
            {status === 'GIVEN' && selected.stockMedicine && <div><Label htmlFor="stock-units-used">{selected.stockMedicine.name} used ({selected.stockMedicine.unit})</Label><Input id="stock-units-used" type="number" min="1" step="1" required value={stockQuantity} onChange={(e) => setStockQuantity(e.target.value)} /><p className="mt-1 text-xs text-slate-500">Enter the actual inventory units used. Saving this dose deducts that amount and adds its charge to the patient bill.</p></div>}
            <div><Label htmlFor="given-at">Date and time</Label><Input id="given-at" type="datetime-local" required value={time} onChange={(e) => setTime(e.target.value)} /></div>
            <div><Label htmlFor="treatment-note">{status === 'GIVEN' ? 'Treatment note (optional)' : 'Why was it not given?'}</Label><Textarea id="treatment-note" required={status !== 'GIVEN'} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={status === 'GIVEN' ? 'Optional details about how the dose was given' : 'Record the reason and any follow-up'} /></div>
            {message && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{message}</p>}
            <div className="flex gap-2"><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save treatment'}</Button><Button type="button" variant="outline" disabled={saving} onClick={() => setSelected(null)}>Cancel</Button></div>
          </form>
        </section>
      </div>}
    </main>
  );
}
