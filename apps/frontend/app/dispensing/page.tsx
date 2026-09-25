'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, PackageX, RefreshCw, Undo2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/useAuth';
import { formatAge } from '@/lib/age';
import { formatPrescription } from '@/lib/prescription';
import { allergySummary, describeConflict, findAllergyConflicts, SEVERITY_LABELS, type Allergy, type AllergyStatus } from '@/lib/allergy';

type Item = {
  id: string;
  medication: string;
  strength: string | null;
  form: string | null;
  dosage: string;
  route: string | null;
  frequency: string;
  duration: string;
  quantity: number | null;
  instructions: string | null;
  allergyOverride: boolean;
  dispensedAt: string | null;
  dispensedQuantity: number | null;
  dispensedBy?: { name: string } | null;
  medicine: { id: string; name: string; quantity: number; unit: string; reorderLevel: number } | null;
  consultation: { id: string; createdAt: string; prescriber: string | null; diagnosis: { icd10Code: string | null; description: string } | null };
  patient: { id: string; name: string; sex: string | null; dateOfBirth: string | null; allergyStatus: AllergyStatus; allergies: Allergy[] | null };
};

type Group = { consultationId: string; patient: Item['patient']; consultation: Item['consultation']; items: Item[] };

function groupByConsultation(items: Item[]): Group[] {
  const groups = new Map<string, Group>();
  for (const item of items) {
    const g = groups.get(item.consultation.id) ?? { consultationId: item.consultation.id, patient: item.patient, consultation: item.consultation, items: [] };
    g.items.push(item);
    groups.set(item.consultation.id, g);
  }
  return [...groups.values()];
}

const api = (path: string) => `${process.env.NEXT_PUBLIC_API_URL}${path}`;
const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });
// A request that sends JSON says so; one with no body must not - the server refuses "JSON" with nothing in it.
const jsonHeaders = () => ({ ...authHeaders(), 'Content-Type': 'application/json' });

export default function DispensingPage() {
  const { hasRole } = useAuth();
  const allowed = hasRole('PHARMACIST', 'ADMIN');

  const [tab, setTab] = useState<'pending' | 'dispensed'>('pending');
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await fetch(api(`/prescriptions?status=${tab}`), { headers: authHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Could not load prescriptions');
      setItems(data.items);
    } catch (e: any) {
      setLoadError(e?.message === 'Failed to fetch' ? 'Unable to reach the Bulamu API. Dispensing needs a connection - check your network and refresh.' : e?.message || 'Could not load prescriptions');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  const groups = useMemo(() => groupByConsultation(items), [items]);

  const dispense = async (item: Item) => {
    setBusy(item.id);
    setErrors((e) => ({ ...e, [item.id]: '' }));
    setNotice('');
    try {
      const qty = quantities[item.id] ?? (item.quantity ? String(item.quantity) : '');
      const res = await fetch(api(`/prescriptions/${item.id}/dispense`), {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify(qty ? { quantity: Number(qty) } : {}),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Could not dispense');
      setItems((list) => list.filter((i) => i.id !== item.id));
      setNotice(
        data.medicine
          ? `${item.medication} dispensed to ${item.patient.name}. ${data.medicine.name}: ${data.medicine.quantity} ${data.medicine.unit} left in stock.`
          : `${item.medication} dispensed to ${item.patient.name}.`
      );
    } catch (e: any) {
      setErrors((prev) => ({ ...prev, [item.id]: e?.message || 'Could not dispense' }));
    } finally {
      setBusy(null);
    }
  };

  const undo = async (item: Item) => {
    if (!confirm(`Reverse the dispensing of ${item.medication} for ${item.patient.name}? It goes back on the waiting list and the quantity returns to stock.`)) return;
    setBusy(item.id);
    setNotice('');
    try {
      const res = await fetch(api(`/prescriptions/${item.id}/undo-dispense`), { method: 'POST', headers: authHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Could not reverse');
      setItems((list) => list.filter((i) => i.id !== item.id));
      setNotice(`Reversed: ${item.medication} for ${item.patient.name} is waiting to be dispensed again.`);
    } catch (e: any) {
      setErrors((prev) => ({ ...prev, [item.id]: e?.message || 'Could not reverse' }));
    } finally {
      setBusy(null);
    }
  };

  if (!allowed) {
    return (
      <div className="min-h-screen bg-slate-50 p-8 dark:bg-slate-950">
        <Card className="mx-auto max-w-lg p-6 text-center text-slate-600 dark:text-slate-400">Only pharmacists and facility administrators can dispense medicines.</Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-8 dark:bg-slate-950">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-200">Dispensing</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Prescriptions waiting to be handed out. Dispensing takes the quantity off your stock.</p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Refresh
          </Button>
        </div>

        <div role="tablist" aria-label="Prescriptions" className="mb-5 inline-flex rounded-md border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
          {([['pending', 'Waiting'], ['dispensed', 'Recently dispensed']] as const).map(([value, label]) => (
            <button
              key={value} role="tab" aria-selected={tab === value}
              onClick={() => { setTab(value); setNotice(''); }}
              className={`rounded px-4 py-1.5 text-sm font-medium ${tab === value ? 'bg-emerald-700 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {notice && (
          <div role="status" className="mb-4 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {notice}
          </div>
        )}

        {loadError && <p role="alert" className="mb-4 text-sm text-rose-600">{loadError}</p>}

        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading...</p>
        ) : groups.length === 0 ? (
          <Card className="p-8 text-center text-slate-500 dark:text-slate-400">
            {tab === 'pending' ? 'Nothing is waiting to be dispensed.' : 'Nothing has been dispensed recently.'}
          </Card>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => {
              const summary = allergySummary(g.patient);
              const age = g.patient.dateOfBirth ? formatAge(g.patient.dateOfBirth) : null;
              return (
                <Card key={g.consultationId} className="gap-4 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{g.patient.name}</h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        {[g.patient.sex ? g.patient.sex.charAt(0) + g.patient.sex.slice(1).toLowerCase() : null, age].filter(Boolean).join(', ') || 'Age and sex not recorded'}
                        {g.consultation.prescriber ? ` | Prescribed by ${g.consultation.prescriber}` : ''}
                        {` | ${new Date(g.consultation.createdAt).toLocaleDateString()}`}
                      </p>
                      {g.consultation.diagnosis && (
                        <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
                          For: {g.consultation.diagnosis.description}{g.consultation.diagnosis.icd10Code ? ` (${g.consultation.diagnosis.icd10Code})` : ''}
                        </p>
                      )}
                    </div>
                  </div>

                  <div
                    className={`rounded-md border px-3 py-2 text-sm ${
                      summary.tone === 'known' ? 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200'
                      : summary.tone === 'none' ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'
                      : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
                    }`}
                  >
                    <span className="font-semibold">{summary.tone === 'known' ? 'Allergies: ' : summary.tone === 'none' ? '' : 'Allergies: '}</span>
                    {summary.tone === 'known'
                      ? (g.patient.allergies ?? []).map((a, i) => (
                          <span key={a.substance}>{i > 0 ? '; ' : ''}{a.substance}{a.severity ? ` (${SEVERITY_LABELS[a.severity].toLowerCase()})` : ''}</span>
                        ))
                      : summary.tone === 'unknown' ? 'not recorded - check with the patient' : summary.text}
                  </div>

                  <ul className="space-y-3">
                    {g.items.map((item) => {
                      const line = formatPrescription(item);
                      const conflicts = findAllergyConflicts(g.patient, item.medication);
                      const qtyText = quantities[item.id] ?? (item.quantity ? String(item.quantity) : '');
                      const qtyNumber = Number(qtyText);
                      const linked = item.medicine;
                      const short = tab === 'pending' && linked && qtyNumber > 0 && linked.quantity < qtyNumber;
                      const needsCheck = conflicts.length > 0 && !checked[item.id];
                      const missingQty = tab === 'pending' && !!linked && !(Number.isInteger(qtyNumber) && qtyNumber >= 1);

                      return (
                        <li key={item.id} className="rounded-md bg-slate-50 p-3 dark:bg-slate-800/60">
                          <p className="font-semibold text-slate-900 dark:text-slate-50">{line.title}</p>
                          {line.sig && <p className="text-sm text-slate-700 dark:text-slate-300">{line.sig}</p>}
                          {line.instructions && <p className="text-xs text-slate-500 dark:text-slate-400">{line.instructions}</p>}

                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                            {item.quantity && <span className="rounded-full bg-slate-200 px-2 py-0.5 font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">Prescribed quantity: {item.quantity}</span>}
                            {linked ? (
                              <span className={`rounded-full px-2 py-0.5 font-medium ${linked.quantity <= linked.reorderLevel ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'}`}>
                                In stock: {linked.quantity} {linked.unit} ({linked.name})
                              </span>
                            ) : (
                              <span className="rounded-full bg-slate-200 px-2 py-0.5 font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">Not linked to stock</span>
                            )}
                            {item.allergyOverride && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 font-medium text-rose-800 dark:bg-rose-900 dark:text-rose-200">
                                <AlertTriangle className="size-3" aria-hidden="true" />
                                Prescriber confirmed despite a recorded allergy
                              </span>
                            )}
                          </div>

                          {tab === 'pending' && conflicts.length > 0 && (
                            <div role="alert" className="mt-3 rounded-md border-2 border-rose-400 bg-rose-50 p-3 text-sm dark:border-rose-700 dark:bg-rose-950/40">
                              <p className="flex items-center gap-2 font-semibold text-rose-900 dark:text-rose-200">
                                <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                                Allergy warning
                              </p>
                              <ul className="mt-1 list-disc pl-6 text-rose-900 dark:text-rose-100">
                                {conflicts.map((c) => <li key={c.allergy.substance}>{describeConflict(c, item.medication)}</li>)}
                              </ul>
                              <label className="mt-2 flex cursor-pointer items-start gap-2 text-rose-900 dark:text-rose-100">
                                <input type="checkbox" className="mt-0.5" checked={!!checked[item.id]} onChange={(e) => setChecked((c) => ({ ...c, [item.id]: e.target.checked }))} />
                                <span>I have checked this allergy with the prescriber and the patient.</span>
                              </label>
                            </div>
                          )}

                          {tab === 'pending' ? (
                            <div className="mt-3 flex flex-wrap items-end gap-3">
                              <div>
                                <Label htmlFor={`qty-${item.id}`} className="text-xs">Quantity to dispense</Label>
                                <Input
                                  id={`qty-${item.id}`} className="mt-1 w-32" type="number" min={1} inputMode="numeric"
                                  value={qtyText} onChange={(e) => setQuantities((q) => ({ ...q, [item.id]: e.target.value }))}
                                />
                              </div>
                              <Button size="sm" onClick={() => dispense(item)} disabled={busy === item.id || needsCheck || missingQty || !!short}>
                                {busy === item.id ? 'Dispensing...' : 'Mark dispensed'}
                              </Button>
                              {short && (
                                <span className="flex items-center gap-1 text-sm text-rose-600">
                                  <PackageX className="size-4" aria-hidden="true" />
                                  Only {linked!.quantity} {linked!.unit} in stock - reduce the quantity or restock first.
                                </span>
                              )}
                              {!short && missingQty && <span className="text-sm text-slate-500 dark:text-slate-400">Enter the quantity so it can be taken off stock.</span>}
                              {!short && needsCheck && <span className="text-sm text-rose-600">Confirm the allergy check to continue.</span>}
                            </div>
                          ) : (
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-300">
                              <span>
                                Dispensed {item.dispensedAt ? new Date(item.dispensedAt).toLocaleString() : ''}
                                {item.dispensedBy ? ` by ${item.dispensedBy.name}` : ''}
                                {item.dispensedQuantity ? ` - ${item.dispensedQuantity}${linked ? ` ${linked.unit}` : ''}` : ''}
                              </span>
                              <Button size="sm" variant="outline" onClick={() => undo(item)} disabled={busy === item.id}>
                                <Undo2 className="size-4" aria-hidden="true" />
                                Undo
                              </Button>
                            </div>
                          )}

                          {errors[item.id] && <p role="alert" className="mt-2 text-sm text-rose-600">{errors[item.id]}</p>}
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
