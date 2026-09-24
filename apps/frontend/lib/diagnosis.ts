import { ICD10_PATTERN } from './icd10';

// The recording form's working state for diagnoses, and how it becomes what is
// saved. The first diagnosis in the list is the primary one (the main reason for
// the visit); the rest are secondary.

export type Certainty = 'CONFIRMED' | 'PROVISIONAL';

export type DiagnosisDraft = {
  key: string;
  icd10Code: string;
  description: string;
  certainty: Certainty;
  notes: string;
};

export type DiagnosisPayload = {
  icd10Code?: string;
  description: string;
  type: 'PRIMARY' | 'SECONDARY';
  certainty: Certainty;
  notes?: string;
};

export type DiagnosisView = {
  id?: string;
  icd10Code?: string | null;
  description: string;
  type?: string;
  certainty?: string;
  notes?: string | null;
};

export const MAX_DIAGNOSES = 10;

let counter = 0;
export function emptyDiagnosis(): DiagnosisDraft {
  counter += 1;
  return { key: `dx-${Date.now()}-${counter}`, icd10Code: '', description: '', certainty: 'CONFIRMED', notes: '' };
}

export const CERTAINTY_LABELS: Record<Certainty, string> = {
  CONFIRMED: 'Confirmed',
  PROVISIONAL: 'Suspected (provisional)',
};

/** What is wrong with the diagnoses entered, in words for the person filling in the form. */
export function diagnosisProblems(drafts: DiagnosisDraft[]): string[] {
  const filled = drafts.filter((d) => d.description.trim() || d.icd10Code.trim());
  if (filled.length === 0) return ['Add at least one diagnosis.'];

  const problems: string[] = [];
  filled.forEach((d, i) => {
    const label = i === 0 ? 'The primary diagnosis' : `Diagnosis ${i + 1}`;
    if (!d.description.trim()) problems.push(`${label} needs a name.`);
    const code = d.icd10Code.trim().toUpperCase();
    if (code && !ICD10_PATTERN.test(code)) problems.push(`${label}: "${d.icd10Code.trim()}" is not a valid ICD-10 code (for example B54 or J18.9).`);
  });
  return problems;
}

/** Blank rows are dropped; the first remaining diagnosis is the primary. */
export function diagnosesToPayload(drafts: DiagnosisDraft[]): DiagnosisPayload[] {
  return drafts
    .filter((d) => d.description.trim())
    .map((d, i) => {
      const payload: DiagnosisPayload = {
        description: d.description.trim(),
        type: i === 0 ? 'PRIMARY' : 'SECONDARY',
        certainty: d.certainty,
      };
      if (d.icd10Code.trim()) payload.icd10Code = d.icd10Code.trim().toUpperCase();
      if (d.notes.trim()) payload.notes = d.notes.trim();
      return payload;
    });
}

/**
 * The diagnoses of a saved consultation, primary first. Consultations recorded
 * before structured diagnoses only have a single text - shown as the primary.
 */
export function diagnosesOf(consultation: { diagnoses?: DiagnosisView[]; diagnosis?: string }): DiagnosisView[] {
  if (consultation.diagnoses && consultation.diagnoses.length > 0) {
    return [...consultation.diagnoses].sort((a, b) => (a.type === b.type ? 0 : a.type === 'PRIMARY' ? -1 : 1));
  }
  return consultation.diagnosis ? [{ description: consultation.diagnosis, type: 'PRIMARY', certainty: 'CONFIRMED' }] : [];
}

/** One line naming the diagnoses, for lists and headings: "Malaria (B54) + Anaemia (D64.9)". */
export function diagnosisHeadline(consultation: { diagnoses?: DiagnosisView[]; diagnosis?: string }): string {
  const list = diagnosesOf(consultation);
  if (list.length === 0) return 'No diagnosis recorded';
  const named = (d: DiagnosisView) => (d.icd10Code ? `${d.description} (${d.icd10Code})` : d.description);
  return list.map(named).join(' + ');
}
