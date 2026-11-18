/**
 * A lab result entered value by value (a blood count, kidney tests...): each
 * parameter with its value, unit and the reference range the lab used, flagged
 * High or Low against it - or Abnormal, for a word reading that differs from the
 * normal one. The templates live in the app (apps/frontend/lib/lab-panels.ts);
 * here the values are checked and the flags worked out again, so a printed
 * flag always matches the value and range beside it.
 */
export type LabFlag = 'H' | 'L' | 'A' | null;
export type LabValue = { name: string; value: string; unit: string | null; low: number | null; high: number | null; normal: string | null; flag: LabFlag };

const MAX_VALUES = 60;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** Same rule as the app's flagFor (lib/lab-panels.ts). */
export function flagFor(value: string, low: number | null, high: number | null, normal: string | null): LabFlag {
  const t = value.trim();
  if (!t) return null;
  const n = Number(t.replace(/^[<>]=?\s*/, '').replace(/,/g, ''));
  if (Number.isFinite(n) && /\d/.test(t)) {
    if (low !== null && n < low) return 'L';
    if (high !== null && n > high) return 'H';
    return null;
  }
  if (normal && t.toLowerCase() !== normal.toLowerCase() && !/^(nil|neg|normal|none|not seen)/i.test(t)) return 'A';
  return null;
}

export const FLAG_WORDS: Record<'H' | 'L' | 'A', string> = { H: 'High', L: 'Low', A: 'Abnormal' };

export function referenceText(v: Pick<LabValue, 'low' | 'high' | 'normal'>): string {
  if (v.low !== null && v.high !== null) return `${v.low} - ${v.high}`;
  if (v.high !== null) return `< ${v.high}`;
  if (v.low !== null) return `> ${v.low}`;
  return v.normal ?? '';
}

/** The values sent with a result, checked; empty rows are left out. Null when none were sent. */
export function parseLabValues(input: unknown): { values: LabValue[] | null } | { error: string } {
  if (input === undefined || input === null) return { values: null };
  if (!Array.isArray(input)) return { error: 'The result values could not be read' };
  if (input.length > MAX_VALUES) return { error: `A result has at most ${MAX_VALUES} values` };
  const values: LabValue[] = [];
  for (const row of input) {
    const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
    const name = text(r.name, 60);
    const value = text(r.value, 40);
    if (!name) return { error: 'Each value needs its name' };
    if (!value) continue;
    const low = num(r.low);
    const high = num(r.high);
    if (low !== null && high !== null && low > high) return { error: `The reference range for ${name} runs the wrong way (${low} - ${high})` };
    const normal = text(r.normal, 40) || null;
    values.push({ name, value, unit: text(r.unit, 20) || null, low, high, normal, flag: flagFor(value, low, high, normal) });
  }
  return { values };
}

/** The result in one line per value, for places that show text (notifications, older screens). */
export function summariseValues(values: LabValue[], comment?: string | null): string {
  const lines = values.map((v) => `${v.name}: ${v.value}${v.unit ? ` ${v.unit}` : ''}${v.flag ? ` (${FLAG_WORDS[v.flag]})` : ''}`);
  if (comment) lines.push(`Comment: ${comment}`);
  return lines.join('\n');
}
