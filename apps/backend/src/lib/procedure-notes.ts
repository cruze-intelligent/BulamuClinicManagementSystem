// Procedures done on the ward and operations, recorded on the inpatient chart
// in the structure clinicians expect: a procedure note (what, why, what was
// found, complications) and a full operation note (operation, team,
// anaesthesia, findings, procedure, blood loss, complications, specimens and
// post-operative orders). Kept in AdmissionNote.details.

export const PROCEDURE_FIELDS = [
  { key: 'procedure', label: 'Procedure', required: true, max: 200 },
  { key: 'indication', label: 'Indication', max: 500 },
  { key: 'details', label: 'What was done and found', required: true, max: 4000 },
  { key: 'complications', label: 'Complications', max: 1000 },
] as const;

export const OPERATION_FIELDS = [
  { key: 'operation', label: 'Operation', required: true, max: 200 },
  { key: 'indication', label: 'Indication', max: 500 },
  { key: 'surgeon', label: 'Surgeon', required: true, max: 120 },
  { key: 'assistant', label: 'Assistant', max: 120 },
  { key: 'anaesthetist', label: 'Anaesthetist', max: 120 },
  { key: 'anaesthesia', label: 'Anaesthesia', required: true, max: 60 },
  { key: 'findings', label: 'Findings', max: 4000 },
  { key: 'procedure', label: 'Procedure', required: true, max: 4000 },
  { key: 'bloodLoss', label: 'Estimated blood loss', max: 60 },
  { key: 'complications', label: 'Complications', max: 1000 },
  { key: 'specimens', label: 'Specimens sent', max: 500 },
  { key: 'postOpOrders', label: 'Post-operative orders', max: 2000 },
] as const;

export const ANAESTHESIA_TYPES = ['General', 'Spinal', 'Epidural', 'Regional block', 'Local', 'Sedation'] as const;

type Field = { key: string; label: string; required?: boolean; max: number };
export type StructuredNote = Record<string, string>;

const FIELDS_FOR: Record<'PROCEDURE' | 'OPERATION_NOTE', readonly Field[]> = { PROCEDURE: PROCEDURE_FIELDS, OPERATION_NOTE: OPERATION_FIELDS };

/** The structured record from what was sent, checked; empty optional fields are left out. */
export function parseStructuredNote(kind: 'PROCEDURE' | 'OPERATION_NOTE', input: unknown): { details: StructuredNote } | { error: string } {
  const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const details: StructuredNote = {};
  for (const field of FIELDS_FOR[kind]) {
    const raw = body[field.key];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) {
      if (field.required) return { error: `${field.label} is needed` };
      continue;
    }
    if (value.length > field.max) return { error: `${field.label} must be at most ${field.max} characters` };
    details[field.key] = value;
  }
  return { details };
}

/** "Label: value" lines, in the standard order - for the chart, the discharge summary and the patient's summary. */
export function structuredNoteLines(kind: string, details: unknown): Array<[string, string]> {
  const fields = FIELDS_FOR[kind as 'PROCEDURE' | 'OPERATION_NOTE'];
  if (!fields || !details || typeof details !== 'object') return [];
  const record = details as Record<string, unknown>;
  return fields.filter((f) => typeof record[f.key] === 'string' && record[f.key]).map((f) => [f.label, String(record[f.key])]);
}

/** One line naming it: "Operation: Caesarean section (Dr Okello, spinal)". */
export function structuredNoteTitle(kind: string, details: unknown): string {
  const record = (details && typeof details === 'object' ? details : {}) as Record<string, string>;
  if (kind === 'OPERATION_NOTE') {
    const by = [record.surgeon, record.anaesthesia?.toLowerCase()].filter(Boolean).join(', ');
    return `Operation: ${record.operation ?? 'not named'}${by ? ` (${by})` : ''}`;
  }
  return `Procedure: ${record.procedure ?? 'not named'}`;
}
