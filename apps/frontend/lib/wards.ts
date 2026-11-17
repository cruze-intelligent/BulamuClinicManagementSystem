// Inpatient vocabulary shared by the ward pages and the patient record.

export const WARD_TYPES = ['GENERAL', 'MALE', 'FEMALE', 'MATERNITY', 'PAEDIATRIC', 'SURGICAL', 'ICU', 'ISOLATION', 'PRIVATE', 'OTHER'] as const;

const WARD_TYPE_LABEL: Record<string, string> = {
  GENERAL: 'General', MALE: 'Male', FEMALE: 'Female', MATERNITY: 'Maternity', PAEDIATRIC: 'Paediatric',
  SURGICAL: 'Surgical', ICU: 'ICU / high dependency', ISOLATION: 'Isolation', PRIVATE: 'Private', OTHER: 'Other',
};
export const wardTypeLabel = (type: string) => WARD_TYPE_LABEL[type] ?? type;

export const DISCHARGE_OUTCOMES = [
  { value: 'RECOVERED', label: 'Discharged - recovered' },
  { value: 'IMPROVED', label: 'Discharged - improved' },
  { value: 'REFERRED', label: 'Referred to another facility' },
  { value: 'LEFT_AGAINST_ADVICE', label: 'Left against medical advice' },
  { value: 'ABSCONDED', label: 'Absconded' },
  { value: 'DIED', label: 'Died' },
] as const;

export const NOTE_KINDS = [
  { value: 'OBSERVATION', label: 'Observations (vitals)' },
  { value: 'NURSING_NOTE', label: 'Nursing note / intervention' },
  { value: 'WARD_ROUND', label: 'Ward round' },
  { value: 'PROCEDURE', label: 'Procedure' },
  // The operating clinician's; the API refuses it from anyone else.
  { value: 'OPERATION_NOTE', label: 'Operation note', roles: ['DOCTOR', 'ADMIN'] },
] as const;

/** How each kind of chart entry is headed in the chart. */
export const KIND_LABEL: Record<string, string> = {
  OBSERVATION: 'Observations', NURSING_NOTE: 'Nursing note / intervention', WARD_ROUND: 'Ward round', TRANSFER: 'Transfer',
  PROCEDURE: 'Procedure', OPERATION_NOTE: 'Operation note',
};

export type StructuredField = { key: string; label: string; required?: boolean; long?: boolean; placeholder?: string };

// The standard fields of a procedure note and an operation note. They match
// apps/backend/src/lib/procedure-notes.ts, which checks them.
export const PROCEDURE_FIELDS: StructuredField[] = [
  { key: 'procedure', label: 'Procedure', required: true, placeholder: 'e.g. Urethral catheterisation, wound debridement, lumbar puncture' },
  { key: 'indication', label: 'Indication' },
  { key: 'details', label: 'What was done and found', required: true, long: true },
  { key: 'complications', label: 'Complications', placeholder: 'None' },
];

export const OPERATION_FIELDS: StructuredField[] = [
  { key: 'operation', label: 'Operation', required: true, placeholder: 'e.g. Emergency caesarean section' },
  { key: 'indication', label: 'Indication' },
  { key: 'surgeon', label: 'Surgeon', required: true },
  { key: 'assistant', label: 'Assistant' },
  { key: 'anaesthetist', label: 'Anaesthetist' },
  { key: 'anaesthesia', label: 'Anaesthesia', required: true },
  { key: 'findings', label: 'Findings', long: true },
  { key: 'procedure', label: 'Procedure', required: true, long: true, placeholder: 'Incision, steps, closure' },
  { key: 'bloodLoss', label: 'Estimated blood loss', placeholder: 'e.g. 400 ml' },
  { key: 'complications', label: 'Complications', placeholder: 'None' },
  { key: 'specimens', label: 'Specimens sent', placeholder: 'None' },
  { key: 'postOpOrders', label: 'Post-operative orders', long: true },
];

export const ANAESTHESIA_TYPES = ['General', 'Spinal', 'Epidural', 'Regional block', 'Local', 'Sedation'] as const;

export const structuredFields = (kind: string): StructuredField[] | null =>
  kind === 'PROCEDURE' ? PROCEDURE_FIELDS : kind === 'OPERATION_NOTE' ? OPERATION_FIELDS : null;

/** What the entry is about, in one line: "Emergency caesarean section - Dr Ogwang, spinal". */
export function structuredTitle(kind: string, details: Record<string, string> | null | undefined): string {
  if (!details) return '';
  if (kind === 'OPERATION_NOTE') return [details.operation, [details.surgeon, details.anaesthesia?.toLowerCase()].filter(Boolean).join(', ')].filter(Boolean).join(' - ');
  return details.procedure ?? '';
}

/** What the entry should say before it can be saved, or null. */
export function structuredProblem(kind: string, details: Record<string, string>): string | null {
  const missing = (structuredFields(kind) ?? []).find((f) => f.required && !details[f.key]?.trim());
  return missing ? `${missing.label} is needed` : null;
}

export const VITAL_FIELDS = [
  { key: 'temperatureC', label: 'Temp (°C)', min: 30, max: 45, step: '0.1' },
  { key: 'pulse', label: 'Pulse', min: 20, max: 250, step: '1' },
  { key: 'respiratoryRate', label: 'Resp. rate', min: 5, max: 80, step: '1' },
  { key: 'systolic', label: 'BP systolic', min: 50, max: 260, step: '1' },
  { key: 'diastolic', label: 'BP diastolic', min: 20, max: 160, step: '1' },
  { key: 'spo2', label: 'SpO2 (%)', min: 50, max: 100, step: '1' },
  { key: 'weightKg', label: 'Weight (kg)', min: 0.3, max: 300, step: '0.1' },
] as const;

/** "T 38.5°C · P 110 · BP 120/80 · SpO2 95%" for the chart. */
export function vitalsText(vitals: Record<string, number> | null | undefined): string {
  if (!vitals) return '';
  const parts: string[] = [];
  if (vitals.temperatureC !== undefined) parts.push(`T ${vitals.temperatureC}°C`);
  if (vitals.pulse !== undefined) parts.push(`P ${vitals.pulse}`);
  if (vitals.respiratoryRate !== undefined) parts.push(`RR ${vitals.respiratoryRate}`);
  if (vitals.systolic !== undefined || vitals.diastolic !== undefined) parts.push(`BP ${vitals.systolic ?? '?'}/${vitals.diastolic ?? '?'}`);
  if (vitals.spo2 !== undefined) parts.push(`SpO2 ${vitals.spo2}%`);
  if (vitals.weightKg !== undefined) parts.push(`Wt ${vitals.weightKg} kg`);
  return parts.join(' · ');
}

/** Readings outside the usual adult range, so the chart can flag them. */
export function abnormalVitals(vitals: Record<string, number> | null | undefined): string[] {
  if (!vitals) return [];
  const flags: string[] = [];
  if (vitals.temperatureC !== undefined && (vitals.temperatureC >= 37.5 || vitals.temperatureC < 35.5)) flags.push(vitals.temperatureC >= 37.5 ? 'Fever' : 'Low temperature');
  if (vitals.pulse !== undefined && (vitals.pulse > 100 || vitals.pulse < 50)) flags.push(vitals.pulse > 100 ? 'Fast pulse' : 'Slow pulse');
  if (vitals.respiratoryRate !== undefined && vitals.respiratoryRate > 24) flags.push('Fast breathing');
  if (vitals.systolic !== undefined && (vitals.systolic < 90 || vitals.systolic >= 160)) flags.push(vitals.systolic < 90 ? 'Low BP' : 'High BP');
  if (vitals.spo2 !== undefined && vitals.spo2 < 92) flags.push('Low oxygen');
  return flags;
}
