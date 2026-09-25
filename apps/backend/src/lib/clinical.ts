/**
 * Diagnoses and prescriptions: validation, HMIS classification and the
 * standard wording a clinician expects to read on a prescription.
 *
 * Input from the app - online or replayed from an offline queue - is checked
 * and reduced to known fields here before anything is stored, so a stray or
 * hostile field never reaches the database, and every consumer (routes, sync,
 * reports, PDFs) sees one consistent shape.
 */

// ICD-10 codes: a letter, two digits, optionally a dot and up to four more
// characters (B54, J18.9, O80.0, S52.501). Format only - a facility may use any
// valid ICD-10 code, so this does not check against a fixed list.
export const ICD10_PATTERN = /^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/;

const MAX_DIAGNOSES = 10;
const MAX_PRESCRIPTIONS = 30;

export type DiagnosisInput = {
  icd10Code: string | null;
  description: string;
  type: 'PRIMARY' | 'SECONDARY';
  certainty: 'CONFIRMED' | 'PROVISIONAL';
  notes: string | null;
};

export type PrescriptionInput = {
  medication: string;
  strength: string | null;
  form: string | null;
  dosage: string;
  route: string | null;
  frequency: string;
  duration: string;
  quantity: number | null;
  instructions: string | null;
  medicineId: string | null;
  /** The prescriber saw a recorded allergy matching this medicine and prescribed it anyway. */
  allergyOverride: boolean;
};

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Trimmed text of at most `max` characters; anything that is not a string is empty. */
function text(value: unknown, max: number): { value: string; tooLong: boolean } {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return { value: trimmed, tooLong: trimmed.length > max };
}

/**
 * Validates a consultation's diagnoses. A structured `diagnoses` array is
 * preferred; a plain `diagnosis` string (older clients, and offline records
 * queued before this change) becomes one uncoded primary diagnosis. Exactly one
 * diagnosis is primary: the first one marked primary, or else the first listed.
 */
export function normalizeDiagnoses(raw: unknown, legacyDiagnosis?: unknown): Validated<DiagnosisInput[]> {
  const items: unknown[] = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [{ description: legacyDiagnosis }] : [];
  if (raw !== undefined && raw !== null && !Array.isArray(raw)) return fail('diagnoses must be a list');
  if (items.length === 0) return fail('At least one diagnosis is required');
  if (items.length > MAX_DIAGNOSES) return fail(`A consultation can have at most ${MAX_DIAGNOSES} diagnoses`);

  const out: DiagnosisInput[] = [];
  for (const [index, item] of items.entries()) {
    const n = index + 1;
    if (!item || typeof item !== 'object') return fail(`Diagnosis ${n} is not valid`);
    const d = item as Record<string, unknown>;

    const description = text(d.description, 200);
    if (!description.value) return fail(raw === undefined || raw === null ? 'At least one diagnosis is required' : `Diagnosis ${n} needs a description`);
    if (description.tooLong) return fail(`Diagnosis ${n}: description is too long (200 characters max)`);

    let icd10Code: string | null = null;
    const codeText = text(d.icd10Code, 10).value.toUpperCase();
    if (codeText) {
      if (!ICD10_PATTERN.test(codeText)) return fail(`Diagnosis ${n}: "${codeText}" is not a valid ICD-10 code (for example B54 or J18.9)`);
      icd10Code = codeText;
    }

    const certainty = d.certainty === undefined || d.certainty === null || d.certainty === '' ? 'CONFIRMED' : d.certainty;
    if (certainty !== 'CONFIRMED' && certainty !== 'PROVISIONAL') return fail(`Diagnosis ${n}: certainty must be CONFIRMED or PROVISIONAL`);

    if (d.type !== undefined && d.type !== null && d.type !== 'PRIMARY' && d.type !== 'SECONDARY') {
      return fail(`Diagnosis ${n}: type must be PRIMARY or SECONDARY`);
    }

    const notes = text(d.notes, 500);
    if (notes.tooLong) return fail(`Diagnosis ${n}: notes are too long (500 characters max)`);

    out.push({
      icd10Code,
      description: description.value,
      type: d.type === 'PRIMARY' ? 'PRIMARY' : 'SECONDARY',
      certainty,
      notes: notes.value || null,
    });
  }

  const primaryIndex = Math.max(0, out.findIndex((d) => d.type === 'PRIMARY'));
  out.forEach((d, i) => { d.type = i === primaryIndex ? 'PRIMARY' : 'SECONDARY'; });
  out.sort((a, b) => (a.type === b.type ? 0 : a.type === 'PRIMARY' ? -1 : 1));
  return { ok: true, value: out };
}

/**
 * Validates prescription items. Deliberately lenient about the older free-text
 * fields (dosage, frequency and duration may be empty or any wording): records
 * queued on devices before structured prescribing must still sync. The screens
 * enforce completeness for new prescriptions; this enforces safety and shape.
 * Rows without a medication name are dropped (blank form rows).
 */
export function normalizePrescriptions(raw: unknown): Validated<PrescriptionInput[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return fail('prescriptions must be a list');
  if (raw.length > MAX_PRESCRIPTIONS) return fail(`A consultation can have at most ${MAX_PRESCRIPTIONS} prescription items`);

  const limits = { medication: 120, strength: 40, form: 40, dosage: 80, route: 20, frequency: 40, duration: 40, instructions: 300, medicineId: 64 } as const;
  const out: PrescriptionInput[] = [];

  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== 'object') return fail(`Prescription ${index + 1} is not valid`);
    const p = item as Record<string, unknown>;

    const fields: Record<keyof typeof limits, string> = {} as any;
    for (const key of Object.keys(limits) as Array<keyof typeof limits>) {
      const { value, tooLong } = text(p[key], limits[key]);
      if (tooLong) return fail(`Prescription ${index + 1}: ${key} is too long (${limits[key]} characters max)`);
      fields[key] = value;
    }
    if (!fields.medication) continue;

    let quantity: number | null = null;
    if (p.quantity !== undefined && p.quantity !== null && p.quantity !== '') {
      const q = Number(p.quantity);
      if (!Number.isInteger(q) || q < 1 || q > 100000) return fail(`Prescription ${index + 1}: quantity must be a whole number between 1 and 100000`);
      quantity = q;
    }

    out.push({
      medication: fields.medication,
      strength: fields.strength || null,
      form: fields.form || null,
      dosage: fields.dosage,
      route: fields.route || null,
      frequency: fields.frequency,
      duration: fields.duration,
      quantity,
      instructions: fields.instructions || null,
      medicineId: fields.medicineId || null,
      allergyOverride: p.allergyOverride === true,
    });
  }
  return { ok: true, value: out };
}

// ---------------------------------------------------------------------------
// Allergies
// ---------------------------------------------------------------------------

export type AllergyStatus = 'UNKNOWN' | 'NONE_KNOWN' | 'KNOWN';
export type AllergyInput = { substance: string; reaction: string | null; severity: 'MILD' | 'MODERATE' | 'SEVERE' | null };

const MAX_ALLERGIES = 20;

/**
 * Validates an allergy record. The status says what is known: UNKNOWN (nobody
 * has asked), NONE_KNOWN (asked - none) or KNOWN (the list applies). Only KNOWN
 * carries a list, and it must not be empty - "has allergies" with nothing named
 * would look like a record but tell the prescriber nothing.
 */
export function normalizeAllergies(status: unknown, raw: unknown): Validated<{ status: AllergyStatus; allergies: AllergyInput[] }> {
  if (status !== 'UNKNOWN' && status !== 'NONE_KNOWN' && status !== 'KNOWN') {
    return fail('allergyStatus must be UNKNOWN, NONE_KNOWN or KNOWN');
  }
  if (status !== 'KNOWN') return { ok: true, value: { status, allergies: [] } };

  if (!Array.isArray(raw)) return fail('allergies must be a list');
  if (raw.length > MAX_ALLERGIES) return fail(`At most ${MAX_ALLERGIES} allergies can be recorded`);

  const out: AllergyInput[] = [];
  const seen = new Set<string>();
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== 'object') return fail(`Allergy ${index + 1} is not valid`);
    const a = item as Record<string, unknown>;

    const substance = text(a.substance, 80);
    if (substance.tooLong) return fail(`Allergy ${index + 1}: the name is too long (80 characters max)`);
    if (!substance.value) continue; // a blank row
    const reaction = text(a.reaction, 120);
    if (reaction.tooLong) return fail(`Allergy ${index + 1}: the reaction is too long (120 characters max)`);

    if (a.severity !== undefined && a.severity !== null && a.severity !== '' && a.severity !== 'MILD' && a.severity !== 'MODERATE' && a.severity !== 'SEVERE') {
      return fail(`Allergy ${index + 1}: severity must be MILD, MODERATE or SEVERE`);
    }

    const key = substance.value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ substance: substance.value, reaction: reaction.value || null, severity: (a.severity || null) as AllergyInput['severity'] });
  }
  if (out.length === 0) return fail('Name at least one allergy, or record that there are none known');
  return { ok: true, value: { status, allergies: out } };
}

/** The value kept in the legacy `diagnosis` column: the primary diagnosis's name. */
export function primaryDiagnosisText(diagnoses: Array<{ description: string; type: string }>): string {
  return (diagnoses.find((d) => d.type === 'PRIMARY') ?? diagnoses[0]).description;
}

/**
 * The most common conditions in a set of primary diagnoses. Grouped by ICD-10
 * code when there is one - so "Malaria" and "malaria (RDT+)" are one condition -
 * and by the wording (ignoring case) when there is not. Each is shown under the
 * wording used most often for it. Same shape the monthly report has always had.
 */
export function rankDiagnoses(
  diagnoses: Array<{ icd10Code: string | null; description: string }>,
  limit = 5
): Array<{ diagnosis: string; icd10Code: string | null; _count: { diagnosis: number } }> {
  const groups = new Map<string, { icd10Code: string | null; count: number; wordings: Map<string, number> }>();
  for (const d of diagnoses) {
    const key = d.icd10Code ? `code:${d.icd10Code}` : `text:${d.description.trim().toLowerCase()}`;
    const group = groups.get(key) ?? { icd10Code: d.icd10Code, count: 0, wordings: new Map() };
    group.count++;
    group.wordings.set(d.description, (group.wordings.get(d.description) ?? 0) + 1);
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((g) => ({
      diagnosis: [...g.wordings.entries()].sort((a, b) => b[1] - a[1])[0][0],
      icd10Code: g.icd10Code,
      _count: { diagnosis: g.count },
    }));
}

// ---------------------------------------------------------------------------
// HMIS 105 classification
// ---------------------------------------------------------------------------

export type HmisCondition = 'malaria' | 'fever' | 'dysentery' | 'measles' | 'meningitis' | 'respiratory' | 'other';

function codeNumber(code: string, letter: string): number | null {
  return code[0] === letter ? Number(code.slice(1, 3)) : null;
}

/**
 * Which HMIS 105 surveillance line a diagnosis counts under. The ICD-10 code
 * decides when there is one; free text (records made before coding) falls back
 * to keyword matching. A malaria code counts as confirmed malaria only when the
 * diagnosis is CONFIRMED - a suspected (provisional) malaria is reported under
 * suspected fever / unconfirmed malaria, which is the distinction the report
 * exists to make.
 */
export function classifyHmisCondition(input: { icd10Code?: string | null; description: string; certainty?: string | null }): HmisCondition {
  const code = (input.icd10Code || '').toUpperCase();
  if (code) {
    const b = codeNumber(code, 'B');
    if (b !== null && b >= 50 && b <= 54) return input.certainty === 'PROVISIONAL' ? 'fever' : 'malaria';
    if (b === 5) return 'measles';
    if (code.startsWith('R50')) return 'fever';
    const a = codeNumber(code, 'A');
    if (a !== null && a <= 9) return 'dysentery';
    if (code.startsWith('A39')) return 'meningitis';
    const g = codeNumber(code, 'G');
    if (g !== null && g <= 3) return 'meningitis';
    const j = codeNumber(code, 'J');
    if (j !== null && j <= 22) return 'respiratory';
    return 'other';
  }

  const diag = input.description.toLowerCase();
  if (diag.includes('malaria')) return input.certainty === 'PROVISIONAL' ? 'fever' : 'malaria';
  if (diag.includes('fever') || diag.includes('pyrexia')) return 'fever';
  if (diag.includes('dysentery') || diag.includes('diarrhea') || diag.includes('diarrhoea')) return 'dysentery';
  if (diag.includes('measles')) return 'measles';
  if (diag.includes('meningitis')) return 'meningitis';
  if (diag.includes('respiratory') || diag.includes('cough') || diag.includes('pneumonia')) return 'respiratory';
  return 'other';
}

// ---------------------------------------------------------------------------
// Prescription wording. Keep in step with apps/frontend/lib/prescription.ts.
// ---------------------------------------------------------------------------

const FREQUENCY_LABELS: Record<string, string> = {
  OD: 'once daily',
  BD: 'twice daily',
  TDS: 'three times daily',
  QDS: 'four times daily',
  MANE: 'in the morning',
  NOCTE: 'at night',
  Q4H: 'every 4 hours',
  Q6H: 'every 6 hours',
  Q8H: 'every 8 hours',
  Q12H: 'every 12 hours',
  STAT: 'immediately, as a single dose',
  PRN: 'when required',
  WEEKLY: 'once a week',
};

const ROUTE_LABELS: Record<string, { text: string; verb: string }> = {
  PO: { text: 'by mouth', verb: 'Take' },
  SL: { text: 'under the tongue', verb: 'Place' },
  IV: { text: 'intravenously', verb: 'Give' },
  IM: { text: 'by intramuscular injection', verb: 'Give' },
  SC: { text: 'by subcutaneous injection', verb: 'Give' },
  PR: { text: 'rectally', verb: 'Insert' },
  PV: { text: 'vaginally', verb: 'Insert' },
  TOP: { text: 'to the skin', verb: 'Apply' },
  INH: { text: 'by inhalation', verb: 'Inhale' },
  EYE: { text: 'in the eye', verb: 'Instil' },
  EAR: { text: 'in the ear', verb: 'Instil' },
  NASAL: { text: 'in the nose', verb: 'Instil' },
};

/** "TDS" -> "three times daily (TDS)"; wording that is not a known code is kept as written. */
export function describeFrequency(frequency: string): string {
  const label = FREQUENCY_LABELS[frequency.trim().toUpperCase()];
  return label ? `${label} (${frequency.trim().toUpperCase()})` : frequency.trim();
}

export type PrescriptionLine = { title: string; sig: string; quantity: string | null; instructions: string | null };

/**
 * A prescription the way it is written on paper: the drug (name, strength,
 * form) and the "sig" - the directions - in plain words, e.g.
 * "Take 1 capsule by mouth three times daily (TDS) for 5 days".
 */
export function formatPrescriptionLine(rx: {
  medication: string; strength?: string | null; form?: string | null; dosage?: string | null; route?: string | null;
  frequency?: string | null; duration?: string | null; quantity?: number | null; instructions?: string | null;
}): PrescriptionLine {
  const title = [rx.medication, rx.strength, rx.form].filter(Boolean).join(' ');
  const route = ROUTE_LABELS[(rx.route || '').toUpperCase()];
  const parts = [
    route?.verb,
    rx.dosage?.trim(),
    route?.text,
    rx.frequency?.trim() ? describeFrequency(rx.frequency) : '',
    rx.duration?.trim() ? `for ${rx.duration.trim()}` : '',
  ].filter(Boolean);
  return {
    title,
    sig: parts.join(' '),
    quantity: rx.quantity ? `Dispense: ${rx.quantity}` : null,
    instructions: rx.instructions?.trim() || null,
  };
}
