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
  { value: 'NURSING_NOTE', label: 'Nursing note' },
  { value: 'WARD_ROUND', label: 'Ward round' },
] as const;

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
