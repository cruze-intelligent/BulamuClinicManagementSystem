// Prescription vocabulary and wording. The abbreviations are the standard ones
// every prescriber and pharmacist reads (OD, BD, TDS, PO, IM...), and the
// directions ("sig") are written out in plain words next to them, so the same
// prescription reads correctly to a doctor, a pharmacist and a patient.
//
// The wording here must match apps/backend/src/lib/clinical.ts (which prints
// the PDF and builds the FHIR export) - change one, change the other.

export type RouteCode = 'PO' | 'SL' | 'IV' | 'IM' | 'SC' | 'PR' | 'PV' | 'TOP' | 'INH' | 'EYE' | 'EAR' | 'NASAL';

export const ROUTES: Array<{ code: RouteCode; label: string; text: string; verb: string }> = [
  { code: 'PO', label: 'PO - by mouth', text: 'by mouth', verb: 'Take' },
  { code: 'SL', label: 'SL - under the tongue', text: 'under the tongue', verb: 'Place' },
  { code: 'IV', label: 'IV - intravenous', text: 'intravenously', verb: 'Give' },
  { code: 'IM', label: 'IM - intramuscular injection', text: 'by intramuscular injection', verb: 'Give' },
  { code: 'SC', label: 'SC - subcutaneous injection', text: 'by subcutaneous injection', verb: 'Give' },
  { code: 'PR', label: 'PR - rectal', text: 'rectally', verb: 'Insert' },
  { code: 'PV', label: 'PV - vaginal', text: 'vaginally', verb: 'Insert' },
  { code: 'TOP', label: 'TOP - on the skin', text: 'to the skin', verb: 'Apply' },
  { code: 'INH', label: 'INH - inhaled', text: 'by inhalation', verb: 'Inhale' },
  { code: 'EYE', label: 'Eye', text: 'in the eye', verb: 'Instil' },
  { code: 'EAR', label: 'Ear', text: 'in the ear', verb: 'Instil' },
  { code: 'NASAL', label: 'Nose', text: 'in the nose', verb: 'Instil' },
];

export const FREQUENCIES: Array<{ code: string; label: string; phrase: string; dosesPerDay: number | null }> = [
  { code: 'OD', label: 'OD - once daily', phrase: 'once daily', dosesPerDay: 1 },
  { code: 'BD', label: 'BD - twice daily', phrase: 'twice daily', dosesPerDay: 2 },
  { code: 'TDS', label: 'TDS - three times daily', phrase: 'three times daily', dosesPerDay: 3 },
  { code: 'QDS', label: 'QDS - four times daily', phrase: 'four times daily', dosesPerDay: 4 },
  { code: 'MANE', label: 'Mane - in the morning', phrase: 'in the morning', dosesPerDay: 1 },
  { code: 'NOCTE', label: 'Nocte - at night', phrase: 'at night', dosesPerDay: 1 },
  { code: 'Q4H', label: 'Q4H - every 4 hours', phrase: 'every 4 hours', dosesPerDay: 6 },
  { code: 'Q6H', label: 'Q6H - every 6 hours', phrase: 'every 6 hours', dosesPerDay: 4 },
  { code: 'Q8H', label: 'Q8H - every 8 hours', phrase: 'every 8 hours', dosesPerDay: 3 },
  { code: 'Q12H', label: 'Q12H - every 12 hours', phrase: 'every 12 hours', dosesPerDay: 2 },
  { code: 'WEEKLY', label: 'Once a week', phrase: 'once a week', dosesPerDay: 1 / 7 },
  { code: 'PRN', label: 'PRN - when required', phrase: 'when required', dosesPerDay: null },
  { code: 'STAT', label: 'STAT - immediately, once', phrase: 'immediately, as a single dose', dosesPerDay: null },
];

export const DOSAGE_FORMS = [
  'tablet', 'capsule', 'suspension', 'syrup', 'oral solution', 'injection', 'cream', 'ointment', 'gel', 'lotion',
  'eye drops', 'eye ointment', 'ear drops', 'inhaler', 'nebuliser solution', 'suppository', 'pessary', 'sachet', 'solution', 'powder',
] as const;

// What one dose of a form is usually counted in.
const FORM_DOSE_UNIT: Record<string, string> = {
  tablet: 'tablet', capsule: 'capsule', suspension: 'ml', syrup: 'ml', 'oral solution': 'ml', injection: 'ml',
  cream: 'application', ointment: 'application', gel: 'application', lotion: 'application',
  'eye drops': 'drop', 'eye ointment': 'application', 'ear drops': 'drop', inhaler: 'puff',
  'nebuliser solution': 'ml', suppository: 'suppository', pessary: 'pessary', sachet: 'sachet', solution: 'ml', powder: 'sachet',
};

export const DOSE_UNITS = ['tablet', 'capsule', 'ml', 'mg', 'g', 'mcg', 'IU', 'drop', 'puff', 'sachet', 'application', 'suppository', 'pessary'] as const;

// Units that are not made plural ("5 ml", not "5 mls").
const FIXED_UNITS = new Set(['ml', 'mg', 'g', 'mcg', 'IU']);

// Units where "how many to dispense" is a meaningful count or volume.
const COUNTABLE_UNITS = new Set(['tablet', 'capsule', 'ml', 'sachet', 'suppository', 'pessary']);

export const DURATION_UNITS = ['days', 'weeks', 'months'] as const;

export const INSTRUCTION_PRESETS = [
  'Take after food', 'Take before food', 'Take with food', 'Take at bedtime', 'Take with plenty of water',
  'Complete the full course', 'Avoid alcohol', 'Shake well before use', 'Do not crush or chew', 'Dissolve in water before taking',
];

export function defaultDoseUnit(form: string): string {
  return FORM_DOSE_UNIT[form.trim().toLowerCase()] ?? 'tablet';
}

/** "1/2", "1 1/2", "0.5", "2" -> a number; anything else -> null. */
export function parseAmount(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = t.match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[2]) === 0 ? null : Number(fraction[1]) / Number(fraction[2]);
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "tablet" -> "tablets", "suppository" -> "suppositories"; units like ml are never made plural. */
export function pluralUnit(unit: string, count: number): string {
  if (count <= 1 || FIXED_UNITS.has(unit)) return unit;
  return unit.endsWith('y') ? `${unit.slice(0, -1)}ies` : `${unit}s`;
}

/** "1 tablet", "2 tablets", "5 ml", "1/2 tablet". */
export function doseText(amount: string, unit: string): string {
  const a = amount.trim();
  // Something like "1-2" is more than one of the unit even though it is not a number.
  return `${a} ${pluralUnit(unit, parseAmount(a) ?? 2)}`;
}

export function durationText(value: string, unit: string): string {
  const n = Number(value);
  return n === 1 ? `1 ${unit.replace(/s$/, '')}` : `${value.trim()} ${unit}`;
}

// ---------------------------------------------------------------------------
// The form's working state and how it becomes a saved prescription
// ---------------------------------------------------------------------------

export type PrescriptionDraft = {
  key: string;
  medication: string;
  medicineId: string;
  strength: string;
  form: string;
  doseAmount: string;
  doseUnit: string;
  route: string;
  frequency: string;
  durationValue: string;
  durationUnit: string;
  quantity: string;
  instructions: string;
  /** The prescriber has seen an allergy warning for this medicine and chosen to prescribe it. */
  allergyOverride: boolean;
};

export type PrescriptionPayload = {
  medication: string;
  strength?: string;
  form?: string;
  dosage: string;
  route?: string;
  frequency: string;
  duration: string;
  quantity?: number;
  instructions?: string;
  medicineId?: string;
  allergyOverride?: boolean;
};

let draftCounter = 0;
export function emptyDraft(): PrescriptionDraft {
  draftCounter += 1;
  return {
    key: `rx-${Date.now()}-${draftCounter}`,
    medication: '', medicineId: '', strength: '', form: '', doseAmount: '', doseUnit: 'tablet', route: 'PO',
    frequency: '', durationValue: '', durationUnit: 'days', quantity: '', instructions: '', allergyOverride: false,
  };
}

export function isBlankDraft(d: PrescriptionDraft): boolean {
  return !d.medication.trim();
}

/** How many to dispense for the dose, frequency and duration entered - or null when it cannot be worked out. */
export function suggestQuantity(d: Pick<PrescriptionDraft, 'doseAmount' | 'doseUnit' | 'frequency' | 'durationValue' | 'durationUnit'>): number | null {
  if (!COUNTABLE_UNITS.has(d.doseUnit)) return null;
  const amount = parseAmount(d.doseAmount);
  if (amount === null) return null;

  if (d.frequency === 'STAT') return Math.ceil(amount);

  const perDay = FREQUENCIES.find((f) => f.code === d.frequency)?.dosesPerDay;
  const count = Number(d.durationValue);
  if (!perDay || !Number.isFinite(count) || count <= 0) return null;

  const days = d.durationUnit === 'weeks' ? count * 7 : d.durationUnit === 'months' ? count * 30 : count;
  return Math.ceil(amount * perDay * days);
}

/**
 * What is still missing before a prescription line can be saved. Blank rows are
 * skipped, not reported. When the medicine matches a recorded allergy
 * (`allergyConflicts`), the prescriber has to confirm they have seen it.
 */
export function draftProblems(d: PrescriptionDraft, allergyConflicts = 0): string[] {
  if (isBlankDraft(d)) return [];
  const problems: string[] = [];
  if (allergyConflicts > 0 && !d.allergyOverride) problems.push('confirmation of the allergy warning');
  if (parseAmount(d.doseAmount) === null) problems.push('the dose (how much per time)');
  if (!d.route) problems.push('the route');
  if (!d.frequency) problems.push('how often');
  if (d.frequency !== 'STAT' && !(Number(d.durationValue) > 0)) problems.push('for how long');
  if (d.quantity.trim() && !(Number.isInteger(Number(d.quantity)) && Number(d.quantity) >= 1)) problems.push('a whole-number quantity');
  return problems;
}

export function draftToPayload(d: PrescriptionDraft): PrescriptionPayload {
  const payload: PrescriptionPayload = {
    medication: d.medication.trim(),
    dosage: doseText(d.doseAmount, d.doseUnit),
    frequency: d.frequency,
    duration: d.frequency === 'STAT' && !d.durationValue ? '' : durationText(d.durationValue, d.durationUnit),
  };
  if (d.strength.trim()) payload.strength = d.strength.trim();
  if (d.form.trim()) payload.form = d.form.trim();
  if (d.route) payload.route = d.route;
  if (d.quantity.trim()) payload.quantity = Number(d.quantity);
  if (d.instructions.trim()) payload.instructions = d.instructions.trim();
  if (d.medicineId) payload.medicineId = d.medicineId;
  if (d.allergyOverride) payload.allergyOverride = true;
  return payload;
}

// ---------------------------------------------------------------------------
// Reading a prescription back
// ---------------------------------------------------------------------------

export type PrescriptionView = {
  medication: string;
  strength?: string | null;
  form?: string | null;
  dosage?: string | null;
  route?: string | null;
  frequency?: string | null;
  duration?: string | null;
  quantity?: number | null;
  instructions?: string | null;
  allergyOverride?: boolean;
  dispensedAt?: string | null;
  dispensedBy?: { name: string } | null;
};

/** "TDS" -> "three times daily (TDS)"; wording that is not a standard code is kept as written. */
export function describeFrequency(frequency: string): string {
  const f = FREQUENCIES.find((x) => x.code === frequency.trim().toUpperCase());
  return f ? `${f.phrase} (${f.code})` : frequency.trim();
}

/**
 * A prescription the way it is written on paper - the drug (name, strength,
 * form) and the directions in plain words, e.g.
 * "Take 1 capsule by mouth three times daily (TDS) for 5 days". Prescriptions
 * written before structured prescribing (name, dose, frequency, duration only)
 * read sensibly too.
 */
export function formatPrescription(rx: PrescriptionView): { title: string; sig: string; quantity: string | null; instructions: string | null } {
  const route = ROUTES.find((r) => r.code === (rx.route || '').toUpperCase());
  const parts = [
    route?.verb,
    rx.dosage?.trim(),
    route?.text,
    rx.frequency?.trim() ? describeFrequency(rx.frequency) : '',
    rx.duration?.trim() ? `for ${rx.duration.trim()}` : '',
  ].filter(Boolean);
  return {
    title: [rx.medication, rx.strength, rx.form].filter(Boolean).join(' '),
    sig: parts.join(' '),
    quantity: rx.quantity ? `Dispense: ${rx.quantity}` : null,
    instructions: rx.instructions?.trim() || null,
  };
}
