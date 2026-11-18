// Result templates for the lab tests that report several values (a blood count,
// kidney and liver tests, lipids, urinalysis...): each parameter with its unit
// and an adult reference range, so the result is entered value by value, the
// reference range appears by itself, and a value outside it is flagged High or
// Low - as a laboratory report sets it out.
//
// The ranges are common adult reference intervals (by sex where they differ).
// A lab whose own analyser or method gives other ranges - or a child, whose
// ranges differ - changes the range on the result before saving: what is saved
// and printed is the range the lab entered. Tests not listed here keep a single
// free-text result.

export type LabRange = { low?: number; high?: number };
export type LabParameter = {
  name: string;
  unit?: string;
  /** Numeric range: one for everyone, or by sex. */
  range?: LabRange;
  male?: LabRange;
  female?: LabRange;
  /** For a parameter read as words (urinalysis): the normal reading, e.g. "Negative". */
  normal?: string;
};
export type LabPanel = { test: string; parameters: LabParameter[] };

/** One parameter's result as entered (and saved): its value, unit and the reference range used. */
export type LabValue = { name: string; value: string; unit?: string; low?: number | null; high?: number | null; normal?: string | null; flag?: LabFlag };
export type LabFlag = 'H' | 'L' | 'A' | null;

const r = (low?: number, high?: number): LabRange => ({ low, high });

export const LAB_PANELS: LabPanel[] = [
  {
    test: 'Complete blood count (CBC)',
    parameters: [
      { name: 'WBC', unit: 'x10^9/L', range: r(4.0, 10.0) },
      { name: 'Neutrophils #', unit: 'x10^9/L', range: r(1.5, 7.0) },
      { name: 'Lymphocytes #', unit: 'x10^9/L', range: r(1.0, 4.0) },
      { name: 'Monocytes #', unit: 'x10^9/L', range: r(0.2, 1.0) },
      { name: 'Eosinophils #', unit: 'x10^9/L', range: r(0.0, 0.5) },
      { name: 'Basophils #', unit: 'x10^9/L', range: r(0.0, 0.1) },
      { name: 'Neutrophils %', unit: '%', range: r(40, 75) },
      { name: 'Lymphocytes %', unit: '%', range: r(20, 45) },
      { name: 'Monocytes %', unit: '%', range: r(2, 10) },
      { name: 'Eosinophils %', unit: '%', range: r(1, 6) },
      { name: 'Basophils %', unit: '%', range: r(0, 1) },
      { name: 'RBC', unit: 'x10^12/L', male: r(4.5, 5.9), female: r(3.8, 5.2) },
      { name: 'Haemoglobin (HGB)', unit: 'g/dL', male: r(13.0, 17.0), female: r(12.0, 15.5) },
      { name: 'Haematocrit (HCT)', unit: '%', male: r(40, 52), female: r(36, 46) },
      { name: 'MCV', unit: 'fL', range: r(80, 100) },
      { name: 'MCH', unit: 'pg', range: r(27, 33) },
      { name: 'MCHC', unit: 'g/dL', range: r(32, 36) },
      { name: 'RDW-CV', unit: '%', range: r(11.5, 14.5) },
      { name: 'Platelets (PLT)', unit: 'x10^9/L', range: r(150, 400) },
      { name: 'MPV', unit: 'fL', range: r(7.5, 11.5) },
    ],
  },
  { test: 'Haemoglobin (Hb)', parameters: [{ name: 'Haemoglobin', unit: 'g/dL', male: r(13.0, 17.0), female: r(12.0, 15.5) }] },
  { test: 'Erythrocyte sedimentation rate (ESR)', parameters: [{ name: 'ESR', unit: 'mm/hr', male: r(0, 15), female: r(0, 20) }] },
  { test: 'Random blood sugar (RBS)', parameters: [{ name: 'Random blood glucose', unit: 'mmol/L', range: r(3.9, 7.8) }] },
  { test: 'Fasting blood sugar (FBS)', parameters: [{ name: 'Fasting blood glucose', unit: 'mmol/L', range: r(3.9, 5.6) }] },
  { test: 'HbA1c', parameters: [{ name: 'HbA1c', unit: '%', range: r(4.0, 5.6) }] },
  {
    test: 'Renal function tests (urea, creatinine, electrolytes)',
    parameters: [
      { name: 'Urea', unit: 'mmol/L', range: r(2.5, 7.8) },
      { name: 'Creatinine', unit: 'umol/L', male: r(62, 106), female: r(44, 80) },
      { name: 'Sodium (Na)', unit: 'mmol/L', range: r(135, 145) },
      { name: 'Potassium (K)', unit: 'mmol/L', range: r(3.5, 5.1) },
      { name: 'Chloride (Cl)', unit: 'mmol/L', range: r(98, 107) },
      { name: 'Bicarbonate (HCO3)', unit: 'mmol/L', range: r(22, 29) },
    ],
  },
  {
    test: 'Liver function tests (LFTs)',
    parameters: [
      { name: 'ALT', unit: 'U/L', male: r(7, 45), female: r(7, 35) },
      { name: 'AST', unit: 'U/L', range: r(8, 40) },
      { name: 'ALP', unit: 'U/L', range: r(40, 130) },
      { name: 'GGT', unit: 'U/L', male: r(10, 71), female: r(6, 42) },
      { name: 'Total bilirubin', unit: 'umol/L', range: r(3, 21) },
      { name: 'Direct bilirubin', unit: 'umol/L', range: r(0, 5) },
      { name: 'Total protein', unit: 'g/L', range: r(60, 80) },
      { name: 'Albumin', unit: 'g/L', range: r(35, 52) },
    ],
  },
  {
    test: 'Lipid profile',
    parameters: [
      { name: 'Total cholesterol', unit: 'mmol/L', range: r(undefined, 5.2) },
      { name: 'HDL cholesterol', unit: 'mmol/L', male: r(1.0), female: r(1.2) },
      { name: 'LDL cholesterol', unit: 'mmol/L', range: r(undefined, 3.4) },
      { name: 'Triglycerides', unit: 'mmol/L', range: r(undefined, 1.7) },
    ],
  },
  {
    test: 'Thyroid function tests (TFTs)',
    parameters: [
      { name: 'TSH', unit: 'mIU/L', range: r(0.4, 4.0) },
      { name: 'Free T4', unit: 'pmol/L', range: r(12, 22) },
      { name: 'Free T3', unit: 'pmol/L', range: r(3.1, 6.8) },
    ],
  },
  {
    test: 'Coagulation profile (PT/INR, APTT)',
    parameters: [
      { name: 'Prothrombin time (PT)', unit: 's', range: r(11, 13.5) },
      { name: 'INR', range: r(0.8, 1.2) },
      { name: 'APTT', unit: 's', range: r(25, 35) },
    ],
  },
  { test: 'Serum uric acid', parameters: [{ name: 'Uric acid', unit: 'mmol/L', male: r(0.2, 0.42), female: r(0.14, 0.36) }] },
  { test: 'C-reactive protein (CRP)', parameters: [{ name: 'CRP', unit: 'mg/L', range: r(0, 5) }] },
  { test: 'Prostate specific antigen (PSA)', parameters: [{ name: 'Total PSA', unit: 'ng/mL', range: r(0, 4) }] },
  { test: 'Serum calcium', parameters: [{ name: 'Calcium (adjusted)', unit: 'mmol/L', range: r(2.15, 2.55) }] },
  { test: 'CD4 count', parameters: [{ name: 'CD4', unit: 'cells/uL', range: r(500, 1500) }] },
  {
    test: 'Urinalysis',
    parameters: [
      { name: 'Colour', normal: 'Yellow' },
      { name: 'Appearance', normal: 'Clear' },
      { name: 'pH', range: r(4.5, 8.0) },
      { name: 'Specific gravity', range: r(1.005, 1.03) },
      { name: 'Protein', normal: 'Negative' },
      { name: 'Glucose', normal: 'Negative' },
      { name: 'Ketones', normal: 'Negative' },
      { name: 'Blood', normal: 'Negative' },
      { name: 'Bilirubin', normal: 'Negative' },
      { name: 'Urobilinogen', normal: 'Normal' },
      { name: 'Nitrite', normal: 'Negative' },
      { name: 'Leucocytes', normal: 'Negative' },
      { name: 'Microscopy', normal: 'Nil significant' },
    ],
  },
];

/** The template for a test, by its name as the lab list writes it. */
export function labPanelFor(testName: string): LabPanel | undefined {
  const wanted = testName.trim().toLowerCase();
  return LAB_PANELS.find((p) => p.test.toLowerCase() === wanted);
}

/** The range that applies to this patient: by sex where it differs, else the common one. */
export function rangeFor(parameter: LabParameter, sex?: string | null): LabRange | undefined {
  const s = (sex ?? '').toUpperCase();
  if (s === 'MALE' && parameter.male) return parameter.male;
  if (s === 'FEMALE' && parameter.female) return parameter.female;
  return parameter.range ?? parameter.male ?? parameter.female;
}

/** The empty result rows for a test, with this patient's reference ranges filled in. */
export function blankValues(panel: LabPanel, sex?: string | null): LabValue[] {
  return panel.parameters.map((p) => {
    const range = rangeFor(p, sex);
    return { name: p.name, value: '', unit: p.unit, low: range?.low ?? null, high: range?.high ?? null, normal: p.normal ?? null };
  });
}

/**
 * High or Low against the reference range, for a number ("<0.5" and ">300" read
 * as the number); Abnormal for a word reading that differs from the normal one
 * ("Positive" where "Negative" is normal). Nothing when there is no range, or no value.
 */
export function flagFor(value: string, low?: number | null, high?: number | null, normal?: string | null): LabFlag {
  const text = value.trim();
  if (!text) return null;
  const n = Number(text.replace(/^[<>]=?\s*/, '').replace(/,/g, ''));
  if (Number.isFinite(n) && /\d/.test(text)) {
    if (low !== null && low !== undefined && n < low) return 'L';
    if (high !== null && high !== undefined && n > high) return 'H';
    return null;
  }
  if (normal && text.toLowerCase() !== normal.toLowerCase() && !/^(nil|neg|normal|none|not seen)/i.test(text)) return 'A';
  return null;
}

export const FLAG_WORDS: Record<Exclude<LabFlag, null>, string> = { H: 'High', L: 'Low', A: 'Abnormal' };

/** "(3.5 - 5.1)", "(< 5.2)", "(> 1.0)", "Negative" - the reference as printed. */
export function referenceText(v: Pick<LabValue, 'low' | 'high' | 'normal'>): string {
  const has = (x: number | null | undefined): x is number => x !== null && x !== undefined;
  if (has(v.low) && has(v.high)) return `${v.low} - ${v.high}`;
  if (has(v.high)) return `< ${v.high}`;
  if (has(v.low)) return `> ${v.low}`;
  return v.normal ?? '';
}
