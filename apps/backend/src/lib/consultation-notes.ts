import { normalizeVitals, type Vitals } from './vitals';

// The parts of a visit note beyond the complaint and diagnosis: the history,
// the examination findings and the vital signs taken at the visit.
export const MAX_HISTORY = 6000;
export const MAX_EXAMINATION = 6000;

export type ConsultationNotes = { history?: string | null; examination?: string | null; vitals?: Vitals | null };

/** The history, examination and vitals sent with a visit, checked. Fields left out are left as they are. */
export function parseConsultationNotes(body: Record<string, unknown>): { value: ConsultationNotes } | { error: string } {
  const value: ConsultationNotes = {};
  for (const [key, max, label] of [['history', MAX_HISTORY, 'History'], ['examination', MAX_EXAMINATION, 'Examination findings']] as const) {
    if (body[key] === undefined) continue;
    const text = typeof body[key] === 'string' ? (body[key] as string).trim() : '';
    if (text.length > max) return { error: `${label} are too long (${max} characters at most)` };
    value[key] = text || null;
  }
  if (body.vitals !== undefined) {
    const vitals = normalizeVitals(body.vitals);
    if (!vitals.ok) return { error: vitals.error };
    value.vitals = vitals.value;
  }
  return { value };
}
