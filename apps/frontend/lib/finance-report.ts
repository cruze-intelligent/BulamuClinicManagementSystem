import { CHARGE_KINDS, EXPENSE_CATEGORIES, PAYMENT_METHODS } from './finance';

// The facility's financial report: what it can include, what each part can be
// narrowed to, the periods offered, and the download address. The server
// (finance-report.ts) checks all of it again.

export const REPORT_SECTIONS = [
  { value: 'all', label: 'Everything' },
  { value: 'income', label: 'Money received' },
  { value: 'billed', label: 'Billed to patients' },
  { value: 'expenses', label: 'Money paid out' },
  { value: 'outstanding', label: 'Still owed by patients' },
] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number]['value'];

/** What a section can be narrowed to: a payment method, a kind of charge or a kind of spending. */
export function categoriesFor(section: ReportSection): ReadonlyArray<{ value: string; label: string }> {
  if (section === 'income') return PAYMENT_METHODS;
  if (section === 'billed') return CHARGE_KINDS;
  if (section === 'expenses') return EXPENSE_CATEGORIES;
  return [];
}

export const categoryHeading = (section: ReportSection) =>
  section === 'income' ? 'Payment method' : section === 'billed' ? 'Kind of charge' : 'Kind of spending';

export const REPORT_PERIODS = [
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'this-year', label: 'This year so far' },
  { value: 'custom', label: 'Choose dates' },
] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number]['value'];

const pad = (n: number) => String(n).padStart(2, '0');
const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** The first and last day (YYYY-MM-DD, Kampala) of a period, given today in Kampala. */
export function periodDates(period: Exclude<ReportPeriod, 'custom'>, today: string): { from: string; to: string } {
  const [year, month] = today.split('-').map(Number);
  if (period === 'this-month') return { from: `${today.slice(0, 7)}-01`, to: today };
  if (period === 'this-year') return { from: `${year}-01-01`, to: today };
  const y = month === 1 ? year - 1 : year;
  const m = month === 1 ? 12 : month - 1;
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDayOf(y, m))}` };
}

/** A problem with the chosen dates, in words - or null when they will do. */
export function periodProblem(from: string, to: string): string | null {
  if (!from || !to) return 'Choose both dates.';
  if (to < from) return 'The end date is before the start date.';
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > 366) return 'A report covers at most one year - choose a shorter period.';
  return null;
}

export type ReportChoice = { from: string; to: string; section: ReportSection; category: string; format: 'pdf' | 'csv' };

/** The download address's query, leaving out what is not chosen. */
export function reportQuery(choice: ReportChoice): string {
  const query = new URLSearchParams({ from: choice.from, to: choice.to, format: choice.format });
  if (choice.section !== 'all') query.set('section', choice.section);
  if (choice.category && categoriesFor(choice.section).some((c) => c.value === choice.category)) query.set('category', choice.category);
  return query.toString();
}

/** The same name the server gives the file. */
export function reportFileName(choice: ReportChoice): string {
  const what = choice.section === 'all' ? 'all' : choice.section;
  const narrowed = choice.category && categoriesFor(choice.section).some((c) => c.value === choice.category)
    ? `-${choice.category.toLowerCase().replace(/_/g, '-')}` : '';
  return `financial-report-${what}${narrowed}-${choice.from}-to-${choice.to}.${choice.format}`;
}
