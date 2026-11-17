/**
 * Observations recorded on the ward. Each value must be physiologically
 * plausible, so an obvious slip ("375" for 37.5 °C) is caught at the bedside
 * instead of sitting in the chart.
 */
export const VITAL_LIMITS = {
  temperatureC: { label: 'Temperature (°C)', min: 30, max: 45 },
  pulse: { label: 'Pulse (beats/min)', min: 20, max: 250 },
  respiratoryRate: { label: 'Respiratory rate (breaths/min)', min: 5, max: 80 },
  systolic: { label: 'Systolic BP (mmHg)', min: 50, max: 260 },
  diastolic: { label: 'Diastolic BP (mmHg)', min: 20, max: 160 },
  spo2: { label: 'SpO2 (%)', min: 50, max: 100 },
  weightKg: { label: 'Weight (kg)', min: 0.3, max: 300 },
} as const;

export type VitalKey = keyof typeof VITAL_LIMITS;
export type Vitals = Partial<Record<VitalKey, number>>;

export function normalizeVitals(raw: unknown): { ok: true; value: Vitals | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Vitals must be a set of named readings' };

  const vitals: Vitals = {};
  for (const [key, limits] of Object.entries(VITAL_LIMITS) as Array<[VitalKey, (typeof VITAL_LIMITS)[VitalKey]]>) {
    const value = (raw as Record<string, unknown>)[key];
    if (value === undefined || value === null || value === '') continue;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n < limits.min || n > limits.max) {
      return { ok: false, error: `${limits.label} must be between ${limits.min} and ${limits.max}` };
    }
    vitals[key] = Math.round(n * 10) / 10;
  }
  if (vitals.systolic !== undefined && vitals.diastolic !== undefined && vitals.diastolic >= vitals.systolic) {
    return { ok: false, error: 'Diastolic BP must be lower than systolic BP' };
  }
  return { ok: true, value: Object.keys(vitals).length ? vitals : null };
}

/** "T 38.5°C · P 110 · RR 20 · BP 120/80 · SpO2 95% · Wt 62 kg" - as a chart writes them; null when none were taken. */
export function vitalsLine(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Vitals;
  const parts: string[] = [];
  if (v.temperatureC !== undefined) parts.push(`T ${v.temperatureC}°C`);
  if (v.pulse !== undefined) parts.push(`P ${v.pulse}`);
  if (v.respiratoryRate !== undefined) parts.push(`RR ${v.respiratoryRate}`);
  if (v.systolic !== undefined || v.diastolic !== undefined) parts.push(`BP ${v.systolic ?? '?'}/${v.diastolic ?? '?'}`);
  if (v.spo2 !== undefined) parts.push(`SpO2 ${v.spo2}%`);
  if (v.weightKg !== undefined) parts.push(`Wt ${v.weightKg} kg`);
  return parts.length ? parts.join(' · ') : null;
}
