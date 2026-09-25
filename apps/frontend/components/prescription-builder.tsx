'use client';

import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SuggestionInput, type Suggestion } from '@/components/suggestion-input';
import { MEDICINES_CATALOG, searchMedicinesCatalog, type CatalogMedicine, type CatalogVariant } from '@/lib/medicines-catalog';
import {
  DOSAGE_FORMS, DOSE_UNITS, DURATION_UNITS, FREQUENCIES, INSTRUCTION_PRESETS, ROUTES,
  defaultDoseUnit, draftProblems, draftToPayload, emptyDraft, formatPrescription, isBlankDraft, parseAmount, pluralUnit, suggestQuantity,
  type PrescriptionDraft,
} from '@/lib/prescription';
import type { LocalMedicine } from '@/lib/local-first';
import { describeConflict, findAllergyConflicts, type AllergyRecord } from '@/lib/allergy';

const MAX_ITEMS = 30;

// A stock item's unit ("tablets", "capsules", "bottles") as a dose unit.
function stockDoseUnit(unit: string): string {
  const u = unit.trim().toLowerCase().replace(/s$/, '');
  if ((DOSE_UNITS as readonly string[]).includes(u)) return u;
  if (['bottle', 'vial', 'ampoule', 'amp', 'tube'].includes(u)) return 'ml';
  if (u === 'tab') return 'tablet';
  if (u === 'cap') return 'capsule';
  return 'tablet';
}

const catalogEntry = (name: string): CatalogMedicine | undefined =>
  MEDICINES_CATALOG.find((m) => m.name.toLowerCase() === name.trim().toLowerCase());

const variantLabel = (v: CatalogVariant) => `${v.strength} ${v.form}`;

/**
 * Builds the prescription the way it is written on paper: the medicine (its
 * strength and form), how much per dose, the route, how often, for how long, and
 * how many to dispense - each chosen from the standard options so the pharmacist
 * reads exactly what the prescriber meant. Medicines the facility stocks are
 * suggested first, so the pharmacist knows what to dispense from. Under each
 * line, the directions are written out in plain words to check before saving.
 */
export function PrescriptionBuilder({
  value, onChange, stock, showProblems, allergies,
}: {
  value: PrescriptionDraft[];
  onChange: (next: PrescriptionDraft[]) => void;
  stock: LocalMedicine[];
  showProblems?: boolean;
  /** The patient's recorded allergies: a medicine that matches one is flagged and must be confirmed. */
  allergies?: AllergyRecord | null;
}) {
  const update = (key: string, patch: Partial<PrescriptionDraft>) =>
    onChange(value.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const remove = (key: string) => {
    const rest = value.filter((d) => d.key !== key);
    onChange(rest.length > 0 ? rest : [emptyDraft()]);
  };

  const applyVariant = (key: string, medicine: CatalogMedicine, variant: CatalogVariant) =>
    update(key, { strength: variant.strength, form: variant.form, doseUnit: defaultDoseUnit(variant.form), route: medicine.route });

  const suggestionsFor = (text: string): Suggestion[] => {
    const q = text.trim().toLowerCase();
    if (q.length < 2) return [];
    const inStock = stock
      .filter((m) => m.name.toLowerCase().includes(q))
      .slice(0, 5)
      .map((m) => ({ key: `stock:${m.id}`, label: m.name, tag: `In stock: ${m.quantity} ${m.unit}` }));
    const inStockNames = new Set(inStock.map((s) => s.label.toLowerCase()));
    const fromCatalog = searchMedicinesCatalog(text)
      .filter((m) => !inStockNames.has(m.name.toLowerCase()))
      .map((m) => ({ key: `cat:${m.name}`, label: m.name, detail: m.variants.slice(0, 2).map(variantLabel).join(', ') }));
    return [...inStock, ...fromCatalog];
  };

  const pickMedicine = (d: PrescriptionDraft, key: string) => {
    if (key.startsWith('stock:')) {
      const item = stock.find((m) => m.id === key.slice(6));
      if (!item) return;
      const catalog = catalogEntry(item.name);
      update(d.key, {
        medication: item.name, medicineId: item.id, allergyOverride: false, doseUnit: stockDoseUnit(item.unit),
        ...(catalog ? { route: catalog.route } : {}),
        ...(catalog && catalog.variants.length === 1 ? { strength: catalog.variants[0].strength, form: catalog.variants[0].form } : {}),
      });
      return;
    }
    const medicine = MEDICINES_CATALOG.find((m) => m.name === key.slice(4));
    if (!medicine) return;
    const linked = stock.find((m) => m.name.toLowerCase() === medicine.name.toLowerCase());
    const only = medicine.variants.length === 1 ? medicine.variants[0] : null;
    update(d.key, {
      medication: medicine.name, medicineId: linked?.id ?? '', allergyOverride: false, route: medicine.route,
      ...(only ? { strength: only.strength, form: only.form, doseUnit: defaultDoseUnit(only.form) } : {}),
    });
  };

  return (
    <div className="space-y-3">
      {value.map((d, index) => {
        const catalog = catalogEntry(d.medication);
        const linkedStock = d.medicineId ? stock.find((m) => m.id === d.medicineId) : undefined;
        const conflicts = findAllergyConflicts(allergies, d.medication);
        const problems = showProblems ? draftProblems(d, conflicts.length) : [];
        const suggested = suggestQuantity(d);
        const complete = !isBlankDraft(d) && draftProblems(d, conflicts.length).length === 0;
        const line = complete ? formatPrescription(draftToPayload(d)) : null;

        return (
          <div key={d.key} className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/40">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Medicine {index + 1}</span>
              {(value.length > 1 || d.medication) && (
                <Button
                  type="button" size="icon-sm" variant="ghost" onClick={() => remove(d.key)}
                  title="Remove this medicine" aria-label="Remove this medicine"
                  className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/50"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              )}
            </div>

            <Label htmlFor={`${d.key}-med`}>Medicine (generic name)</Label>
            <SuggestionInput
              id={`${d.key}-med`}
              className="mt-2"
              value={d.medication}
              placeholder="Search or type: amoxicillin, paracetamol, Coartem..."
              onChange={(text) => update(d.key, { medication: text, allergyOverride: false, ...(linkedStock && linkedStock.name !== text ? { medicineId: '' } : {}) })}
              suggestions={suggestionsFor(d.medication)}
              onPick={(key) => pickMedicine(d, key)}
              footer={d.medication.trim().length >= 2 ? <>Your facility&apos;s stock is listed first. Keep typing to use another name.</> : undefined}
            />
            {linkedStock && (
              <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
                Linked to stock: {linkedStock.quantity} {linkedStock.unit} available{linkedStock.quantity <= linkedStock.reorderLevel ? ' - running low' : ''}.
              </p>
            )}

            {conflicts.length > 0 && (
              <div role="alert" className="mt-2 rounded-md border-2 border-rose-400 bg-rose-50 p-3 text-sm dark:border-rose-700 dark:bg-rose-950/40">
                <p className="flex items-center gap-2 font-semibold text-rose-900 dark:text-rose-200">
                  <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                  Allergy warning
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-6 text-rose-900 dark:text-rose-100">
                  {conflicts.map((c) => <li key={c.allergy.substance}>{describeConflict(c, d.medication)}</li>)}
                </ul>
                <label className="mt-2 flex cursor-pointer items-start gap-2 text-rose-900 dark:text-rose-100">
                  <input
                    type="checkbox" className="mt-0.5" checked={d.allergyOverride}
                    onChange={(e) => update(d.key, { allergyOverride: e.target.checked })}
                  />
                  <span>I have considered this allergy and still want to prescribe {d.medication.trim()}. This will be recorded on the prescription.</span>
                </label>
              </div>
            )}

            {catalog && catalog.variants.length > 1 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Common strengths and forms">
                <span className="text-xs text-slate-500 dark:text-slate-400">Common:</span>
                {catalog.variants.map((variant) => {
                  const selected = d.strength === variant.strength && d.form === variant.form;
                  return (
                    <button
                      key={variantLabel(variant)}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => applyVariant(d.key, catalog, variant)}
                      className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                        selected
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : 'border-slate-300 bg-white text-slate-700 hover:border-emerald-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200'
                      }`}
                    >
                      {variantLabel(variant)}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor={`${d.key}-strength`}>Strength</Label>
                <Input id={`${d.key}-strength`} className="mt-2" value={d.strength} maxLength={40} placeholder="e.g. 500 mg" onChange={(e) => update(d.key, { strength: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`${d.key}-form`}>Form</Label>
                <Select
                  id={`${d.key}-form`} className="mt-2" value={d.form}
                  onChange={(e) => update(d.key, { form: e.target.value, ...(e.target.value ? { doseUnit: defaultDoseUnit(e.target.value) } : {}) })}
                >
                  <option value="">Select form...</option>
                  {DOSAGE_FORMS.map((f) => <option key={f} value={f}>{f}</option>)}
                  {d.form && !(DOSAGE_FORMS as readonly string[]).includes(d.form) && <option value={d.form}>{d.form}</option>}
                </Select>
              </div>
              <div>
                <Label htmlFor={`${d.key}-route`}>Route</Label>
                <Select id={`${d.key}-route`} className="mt-2" value={d.route} onChange={(e) => update(d.key, { route: e.target.value })}>
                  <option value="">Select route...</option>
                  {ROUTES.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                </Select>
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_1.4fr_1.4fr]">
              <div>
                <Label htmlFor={`${d.key}-dose`}>Dose (each time)</Label>
                <div className="mt-2 flex gap-2">
                  <Input
                    id={`${d.key}-dose`} className="w-20 shrink-0" inputMode="decimal" value={d.doseAmount} placeholder="1"
                    aria-invalid={d.doseAmount.trim() !== '' && parseAmount(d.doseAmount) === null ? true : undefined}
                    onChange={(e) => update(d.key, { doseAmount: e.target.value })}
                  />
                  <Select aria-label="Dose unit" value={d.doseUnit} onChange={(e) => update(d.key, { doseUnit: e.target.value })}>
                    {DOSE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </Select>
                </div>
              </div>
              <div>
                <Label htmlFor={`${d.key}-freq`}>How often</Label>
                <Select id={`${d.key}-freq`} className="mt-2" value={d.frequency} onChange={(e) => update(d.key, { frequency: e.target.value })}>
                  <option value="">Select frequency...</option>
                  {FREQUENCIES.map((f) => <option key={f.code} value={f.code}>{f.label}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor={`${d.key}-duration`}>For how long</Label>
                <div className="mt-2 flex gap-2">
                  <Input
                    id={`${d.key}-duration`} className="w-20 shrink-0" type="number" min={1} inputMode="numeric" value={d.durationValue}
                    placeholder={d.frequency === 'STAT' ? '-' : '5'} disabled={d.frequency === 'STAT'}
                    onChange={(e) => update(d.key, { durationValue: e.target.value })}
                  />
                  <Select aria-label="Duration unit" value={d.durationUnit} disabled={d.frequency === 'STAT'} onChange={(e) => update(d.key, { durationUnit: e.target.value })}>
                    {DURATION_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </Select>
                </div>
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-[10rem_1fr]">
              <div>
                <Label htmlFor={`${d.key}-qty`}>Quantity to dispense</Label>
                <Input
                  id={`${d.key}-qty`} className="mt-2" type="number" min={1} inputMode="numeric" value={d.quantity}
                  placeholder={suggested ? String(suggested) : ''} onChange={(e) => update(d.key, { quantity: e.target.value })}
                />
                {suggested && d.quantity !== String(suggested) && (
                  <button type="button" className="mt-1 text-xs text-emerald-700 hover:underline dark:text-emerald-400" onClick={() => update(d.key, { quantity: String(suggested) })}>
                    Use {suggested} {pluralUnit(d.doseUnit, suggested)} (dose x frequency x duration)
                  </button>
                )}
              </div>
              <div>
                <Label htmlFor={`${d.key}-instr`}>Instructions <span className="font-normal text-slate-400">(optional)</span></Label>
                <Input id={`${d.key}-instr`} className="mt-2" value={d.instructions} maxLength={300} placeholder="e.g. Take after food" onChange={(e) => update(d.key, { instructions: e.target.value })} />
                <Select
                  aria-label="Add a common instruction" className="mt-2" value=""
                  onChange={(e) => e.target.value && update(d.key, { instructions: d.instructions.trim() ? `${d.instructions.trim()}. ${e.target.value}` : e.target.value })}
                >
                  <option value="">Add a common instruction...</option>
                  {INSTRUCTION_PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
                </Select>
              </div>
            </div>

            {line && (
              <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
                <span className="text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">Reads as</span>
                <p className="font-medium text-slate-900 dark:text-slate-100">{line.title}</p>
                <p className="text-slate-700 dark:text-slate-300">{line.sig}{line.instructions ? `. ${line.instructions}` : ''}{line.quantity ? ` (${line.quantity.toLowerCase()})` : ''}</p>
              </div>
            )}

            {problems.length > 0 && (
              <p role="alert" className="mt-3 text-sm text-rose-600">
                {d.medication.trim()}: still needed - {problems.join(', ')}.
              </p>
            )}
          </div>
        );
      })}

      {value.length < MAX_ITEMS && (
        <Button type="button" size="sm" variant="outline" onClick={() => onChange([...value, emptyDraft()])}>
          <Plus className="size-4" aria-hidden="true" />
          Add another medicine
        </Button>
      )}
    </div>
  );
}
