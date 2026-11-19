import { prisma } from './prisma';
import { MODALITIES } from './imaging';

/**
 * The facility's activity day by day, week by week or month by month: patients
 * seen as outpatients, inpatients admitted, discharged and in the ward, and how
 * many of each lab test and imaging examination were asked for - for every
 * patient, or for one sex or age group. Days are Kampala days; a week starts on
 * Monday.
 */

export type ReportPeriod = 'day' | 'week' | 'month';
export const PERIODS: ReportPeriod[] = ['day', 'week', 'month'];

/** Age groups at the time of the visit (HMIS-style bands, with the over-60s apart). */
export const AGE_GROUPS = [
  { key: 'under-5', label: 'Under 5 years', min: 0, max: 5 },
  { key: '5-9', label: '5 - 9 years', min: 5, max: 10 },
  { key: '10-19', label: '10 - 19 years', min: 10, max: 20 },
  { key: '20-59', label: '20 - 59 years', min: 20, max: 60 },
  { key: '60-plus', label: '60 years and over', min: 60, max: Infinity },
] as const;
export type AgeGroupKey = (typeof AGE_GROUPS)[number]['key'] | 'unknown';
export const AGE_UNKNOWN_LABEL = 'Age not recorded';

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 366;
const MAX_DAILY_DAYS = 62;

/** Whole years between a birth date and a moment. */
export function ageInYears(dateOfBirth: Date, at: Date): number {
  let years = at.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday = at.getUTCMonth() < dateOfBirth.getUTCMonth() || (at.getUTCMonth() === dateOfBirth.getUTCMonth() && at.getUTCDate() < dateOfBirth.getUTCDate());
  if (beforeBirthday) years -= 1;
  return Math.max(0, years);
}

export function ageGroupOf(dateOfBirth: Date | null | undefined, at: Date): AgeGroupKey {
  if (!dateOfBirth) return 'unknown';
  const age = ageInYears(dateOfBirth, at);
  return AGE_GROUPS.find((g) => age >= g.min && age < g.max)?.key ?? 'unknown';
}

const dayKey = (at: Date) => new Date(at.getTime() + EAT_OFFSET_MS).toISOString().slice(0, 10);
const dayStart = (key: string) => new Date(Date.parse(`${key}T00:00:00Z`) - EAT_OFFSET_MS);
const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** The Monday of the week a Kampala day falls in. */
function mondayOf(key: string): string {
  const weekday = (new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday 0 ... Sunday 6
  return addDays(key, -weekday);
}

/** The period a moment falls in: its day, the Monday of its week, or its month. */
export function periodKey(at: Date, period: ReportPeriod): string {
  const day = dayKey(at);
  if (period === 'day') return day;
  if (period === 'week') return mondayOf(day);
  return day.slice(0, 7);
}

export type PeriodSlot = { key: string; label: string; short: string; start: Date; end: Date };

const fmt = (key: string, options: Intl.DateTimeFormatOptions) => new Date(`${key}T12:00:00Z`).toLocaleDateString('en-GB', { ...options, timeZone: 'UTC' });

/** Every period from the first day to the last, in order, each with when it starts and ends. */
export function periodsBetween(from: string, to: string, period: ReportPeriod): PeriodSlot[] {
  const slots: PeriodSlot[] = [];
  if (period === 'day') {
    for (let key = from; key <= to; key = addDays(key, 1)) {
      slots.push({ key, label: fmt(key, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), short: fmt(key, { weekday: 'short', day: 'numeric' }), start: dayStart(key), end: dayStart(addDays(key, 1)) });
    }
  } else if (period === 'week') {
    for (let key = mondayOf(from); key <= to; key = addDays(key, 7)) {
      slots.push({ key, label: `Week of ${fmt(key, { day: 'numeric', month: 'short', year: 'numeric' })}`, short: fmt(key, { day: 'numeric', month: 'short' }), start: dayStart(key), end: dayStart(addDays(key, 7)) });
    }
  } else {
    let [y, m] = from.slice(0, 7).split('-').map(Number);
    while (`${y}-${String(m).padStart(2, '0')}` <= to.slice(0, 7)) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
      slots.push({ key, label: fmt(`${key}-01`, { month: 'long', year: 'numeric' }), short: fmt(`${key}-01`, { month: 'short', year: '2-digit' }), start: dayStart(`${key}-01`), end: dayStart(`${next}-01`) });
      [y, m] = next.split('-').map(Number);
    }
  }
  return slots;
}

export type ActivityQuery = { from: string; to: string; period: ReportPeriod; sex: 'FEMALE' | 'MALE' | null; ageGroup: AgeGroupKey | null };

/** The report's choices from a request, or what is wrong with them. Defaults: the last 7 days, by day. */
export function parseActivityQuery(query: Record<string, unknown>, today = dayKey(new Date())): ActivityQuery | { error: string } {
  const period = PERIODS.includes(query.period as ReportPeriod) ? (query.period as ReportPeriod) : 'day';
  const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
  const to = isDay(query.to) ? query.to : today;
  const defaultFrom = period === 'day' ? addDays(to, -6) : period === 'week' ? addDays(mondayOf(to), -7 * 7) : `${to.slice(0, 4)}-01-01`;
  const from = isDay(query.from) ? query.from : defaultFrom;
  if (from > to) return { error: 'The first day must come before the last day' };
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
  if (days > MAX_DAYS) return { error: 'Choose at most a year at a time' };
  if (period === 'day' && days > MAX_DAILY_DAYS) return { error: `Day by day covers at most ${MAX_DAILY_DAYS} days - choose week by week or month by month for longer` };
  const sex = query.sex === 'FEMALE' || query.sex === 'MALE' ? query.sex : null;
  const ageGroup = AGE_GROUPS.some((g) => g.key === query.ageGroup) || query.ageGroup === 'unknown' ? (query.ageGroup as AgeGroupKey) : null;
  return { from, to, period, sex, ageGroup };
}

type Person = { sex: string | null; dateOfBirth: Date | null };

export async function buildActivityReport(clinicId: string, q: ActivityQuery) {
  const slots = periodsBetween(q.from, q.to, q.period);
  const start = dayStart(q.from);
  const end = dayStart(addDays(q.to, 1));
  const person = { select: { sex: true, dateOfBirth: true } } as const;

  const [visits, registered, admissions, tests, imaging] = await Promise.all([
    prisma.consultation.findMany({ where: { deletedAt: null, createdAt: { gte: start, lt: end }, appointment: { clinicId } }, select: { createdAt: true, patientId: true, patient: person } }),
    prisma.patient.findMany({ where: { clinicId, createdAt: { gte: start, lt: end } }, select: { createdAt: true, sex: true, dateOfBirth: true } }),
    prisma.admission.findMany({ where: { clinicId, admittedAt: { lt: end }, OR: [{ dischargedAt: null }, { dischargedAt: { gte: start } }] }, select: { id: true, admittedAt: true, dischargedAt: true, patient: person } }),
    prisma.labTest.findMany({ where: { deletedAt: null, status: { not: 'CANCELLED' }, createdAt: { gte: start, lt: end }, patient: { clinicId } }, select: { testName: true, createdAt: true, patient: person } }),
    prisma.imagingRequest.findMany({ where: { clinicId, status: { not: 'CANCELLED' }, createdAt: { gte: start, lt: end } }, select: { examination: true, modality: true, createdAt: true, patient: person } }),
  ]);

  // The sex and age group asked for, with the age at the time.
  const counts = (p: Person, at: Date) => (!q.sex || p.sex === q.sex) && (!q.ageGroup || ageGroupOf(p.dateOfBirth, at) === q.ageGroup);
  const slotOf = (at: Date) => slots.findIndex((s) => at >= s.start && at < s.end);
  const zeros = () => slots.map(() => 0);

  const outpatients = zeros();
  const patientsSeen = slots.map(() => new Set<string>());
  const bySexAge = new Map<AgeGroupKey, { FEMALE: number; MALE: number; unknown: number }>();
  for (const v of visits) {
    if (!counts(v.patient, v.createdAt)) continue;
    const i = slotOf(v.createdAt);
    if (i < 0) continue;
    outpatients[i] += 1;
    patientsSeen[i].add(v.patientId);
    const group = ageGroupOf(v.patient.dateOfBirth, v.createdAt);
    const row = bySexAge.get(group) ?? { FEMALE: 0, MALE: 0, unknown: 0 };
    row[v.patient.sex === 'FEMALE' ? 'FEMALE' : v.patient.sex === 'MALE' ? 'MALE' : 'unknown'] += 1;
    bySexAge.set(group, row);
  }

  const newPatients = zeros();
  for (const p of registered) {
    if (!counts(p, p.createdAt)) continue;
    const i = slotOf(p.createdAt);
    if (i >= 0) newPatients[i] += 1;
  }

  const admitted = zeros();
  const discharged = zeros();
  const inWard = zeros();
  const inWardAtAll = new Set<string>();
  for (const a of admissions) {
    if (!counts(a.patient, a.admittedAt)) continue;
    const i = slotOf(a.admittedAt);
    if (i >= 0) admitted[i] += 1;
    if (a.dischargedAt) {
      const j = slotOf(a.dischargedAt);
      if (j >= 0) discharged[j] += 1;
    }
    slots.forEach((s, k) => {
      if (a.admittedAt < s.end && (!a.dischargedAt || a.dischargedAt >= s.start)) {
        inWard[k] += 1;
        inWardAtAll.add(a.id);
      }
    });
  }

  // Each test or examination by name (any letter case), most asked for first.
  const tally = <T extends { createdAt: Date; patient: Person }>(rows: T[], nameOf: (row: T) => string, detailOf?: (row: T) => string) => {
    const byName = new Map<string, { name: string; detail?: string; counts: number[]; total: number }>();
    for (const row of rows) {
      if (!counts(row.patient, row.createdAt)) continue;
      const i = slotOf(row.createdAt);
      if (i < 0) continue;
      const name = nameOf(row).trim();
      const key = name.toLowerCase();
      const entry = byName.get(key) ?? { name, ...(detailOf ? { detail: detailOf(row) } : {}), counts: zeros(), total: 0 };
      entry.counts[i] += 1;
      entry.total += 1;
      byName.set(key, entry);
    }
    return [...byName.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  };

  const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);
  const ageRows = [...AGE_GROUPS.map((g) => ({ key: g.key as AgeGroupKey, label: g.label })), { key: 'unknown' as AgeGroupKey, label: AGE_UNKNOWN_LABEL }]
    .map((g) => {
      const row = bySexAge.get(g.key) ?? { FEMALE: 0, MALE: 0, unknown: 0 };
      return { group: g.label, female: row.FEMALE, male: row.MALE, sexNotRecorded: row.unknown, total: row.FEMALE + row.MALE + row.unknown };
    })
    .filter((r) => r.total > 0 || r.group !== AGE_UNKNOWN_LABEL);

  const labTests = tally(tests, (t) => t.testName);
  const imagingDone = tally(imaging, (r) => r.examination, (r) => MODALITIES[r.modality]);

  return {
    from: q.from,
    to: q.to,
    period: q.period,
    sex: q.sex,
    ageGroup: q.ageGroup,
    periods: slots.map((s, i) => ({
      key: s.key, label: s.label, short: s.short,
      outpatients: outpatients[i], patientsSeen: patientsSeen[i].size, newPatients: newPatients[i],
      admitted: admitted[i], discharged: discharged[i], inWard: inWard[i],
    })),
    totals: {
      outpatients: sum(outpatients),
      patientsSeen: new Set(visits.filter((v) => counts(v.patient, v.createdAt) && slotOf(v.createdAt) >= 0).map((v) => v.patientId)).size,
      newPatients: sum(newPatients),
      admitted: sum(admitted),
      discharged: sum(discharged),
      inWard: inWardAtAll.size,
      labTests: sum(labTests.map((t) => t.total)),
      imaging: sum(imagingDone.map((t) => t.total)),
    },
    outpatientsByAgeAndSex: ageRows,
    labTests,
    imaging: imagingDone,
  };
}

/** What the report covers, in words: "Females aged 20 - 59 years", "All patients". */
export function whoText(q: Pick<ActivityQuery, 'sex' | 'ageGroup'>): string {
  const sex = q.sex === 'FEMALE' ? 'Females' : q.sex === 'MALE' ? 'Males' : 'All patients';
  if (!q.ageGroup) return sex;
  const group = q.ageGroup === 'unknown' ? 'with no age recorded' : `aged ${AGE_GROUPS.find((g) => g.key === q.ageGroup)!.label}`;
  return `${sex} ${group}`;
}
