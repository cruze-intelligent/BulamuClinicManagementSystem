// The daily, weekly and monthly report's choices: the period, the days it
// covers, and which patients (one sex, one age group). Kept in step with
// apps/backend/src/lib/activity-report.ts.

export type ActivityPeriod = 'day' | 'week' | 'month';
export type ActivityChoice = { period: ActivityPeriod; from: string; to: string; sex: '' | 'FEMALE' | 'MALE'; ageGroup: string };

export const ACTIVITY_AGE_GROUPS = [
  { key: 'under-5', label: 'Under 5 years' },
  { key: '5-9', label: '5 - 9 years' },
  { key: '10-19', label: '10 - 19 years' },
  { key: '20-59', label: '20 - 59 years' },
  { key: '60-plus', label: '60 years and over' },
  { key: 'unknown', label: 'Age not recorded' },
];

const DAY_MS = 24 * 60 * 60 * 1000;
/** Today in Kampala, as YYYY-MM-DD. */
export const kampalaToday = (now = new Date()) => new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** Where each kind of report starts: the last 7 days, the last 8 weeks (from a Monday), or this year so far. */
export function activityDefaults(period: ActivityPeriod, today = kampalaToday()): ActivityChoice {
  if (period === 'day') return { period, from: addDays(today, -6), to: today, sex: '', ageGroup: '' };
  if (period === 'week') {
    const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
    return { period, from: addDays(today, -weekday - 7 * 7), to: today, sex: '', ageGroup: '' };
  }
  return { period, from: `${today.slice(0, 4)}-01-01`, to: today, sex: '', ageGroup: '' };
}

export function activityQueryString(c: ActivityChoice): string {
  const params = new URLSearchParams({ period: c.period, from: c.from, to: c.to });
  if (c.sex) params.set('sex', c.sex);
  if (c.ageGroup) params.set('ageGroup', c.ageGroup);
  return params.toString();
}
