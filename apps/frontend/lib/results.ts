// The Results section: lab results and imaging reports, gathered by patient and
// day, so a patient's results can be found in one place and printed together.
import { hasAllWords, matchesPatient } from './search';

export type ResultItem = {
  kind: 'lab' | 'imaging';
  id: string;
  patientId: string;
  patientName: string;
  /** The facility's Patient ID, when known - a search can find the patient by it. */
  patientNumber?: number | null;
  name: string;
  /** A line to recognise it by: the result, or the imaging conclusion. */
  summary: string;
  flagged: number;
  verified: boolean;
  at: string;
};

export type ResultGroup = { key: string; patientId: string; patientName: string; day: string; items: ResultItem[] };

/** The Kampala day a moment falls on (YYYY-MM-DD). */
export const kampalaDay = (iso: string) => new Date(new Date(iso).getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

type LabRow = {
  id: string; patientId: string; testName: string; results: string; status: string; createdAt: string; resultedAt?: string | null; verifiedAt?: string | null;
  values?: Array<{ name: string; value: string; flag?: string | null }> | null; patient?: { name: string; patientNumber?: number | null } | null;
};
type ImagingRow = { id: string; examination: string; status: string; impression?: string | null; findings?: string | null; reportedAt?: string | null; requestedAt: string; patient: { id: string; name: string; patientNumber?: number | null } };

export function labItem(t: LabRow): ResultItem | null {
  if (t.status !== 'COMPLETED' || !t.results?.trim()) return null;
  const values = t.values ?? [];
  const flagged = values.filter((v) => v.flag).length;
  const summary = values.length > 1
    ? `${values.length} values${flagged ? `, ${flagged} outside the range` : ', all within the range'}`
    : values.length === 1 ? `${values[0].value}` : t.results.trim();
  return {
    kind: 'lab', id: t.id, patientId: t.patientId, patientName: t.patient?.name ?? 'Patient', patientNumber: t.patient?.patientNumber ?? null, name: t.testName,
    summary: summary.length > 90 ? `${summary.slice(0, 87)}...` : summary, flagged, verified: !!t.verifiedAt, at: t.resultedAt || t.createdAt,
  };
}

export function imagingItem(r: ImagingRow): ResultItem | null {
  if (r.status !== 'REPORTED') return null;
  const summary = (r.impression || r.findings || '').trim();
  return {
    kind: 'imaging', id: r.id, patientId: r.patient.id, patientName: r.patient.name, patientNumber: r.patient.patientNumber ?? null, name: r.examination,
    summary: summary.length > 90 ? `${summary.slice(0, 87)}...` : summary, flagged: 0, verified: true, at: r.reportedAt || r.requestedAt,
  };
}

/** By patient and day, newest first; within a day, lab results before imaging, in the order they came. */
export function groupResults(items: ResultItem[], search = ''): ResultGroup[] {
  const groups = new Map<string, ResultGroup>();
  for (const item of items) {
    // By the patient (name, Patient ID) or the test or examination.
    if (search.trim() && !matchesPatient({ name: item.patientName, patientNumber: item.patientNumber }, search) && !hasAllWords([item.patientName, item.name], search)) continue;
    const day = kampalaDay(item.at);
    const key = `${item.patientId}|${day}`;
    const group = groups.get(key) ?? { key, patientId: item.patientId, patientName: item.patientName, day, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  const latest = (g: ResultGroup) => g.items.reduce((max, i) => (i.at > max ? i.at : max), '');
  return [...groups.values()]
    .map((g) => ({ ...g, items: [...g.items].sort((a, b) => (a.kind === b.kind ? a.at.localeCompare(b.at) : a.kind === 'lab' ? -1 : 1)) }))
    .sort((a, b) => latest(b).localeCompare(latest(a)));
}

/** The address that prints these results together. */
export function printUrl(api: string, items: ResultItem[]): string {
  const ids = (kind: ResultItem['kind']) => items.filter((i) => i.kind === kind).map((i) => i.id).join(',');
  const params = new URLSearchParams();
  if (ids('lab')) params.set('lab', ids('lab'));
  if (ids('imaging')) params.set('imaging', ids('imaging'));
  return `${api}/results/pdf?${params.toString()}`;
}
