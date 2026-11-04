// Words and small calculations for the platform operator's Finances page.

export const STANDING_LABELS = {
  PAID: 'Paid up',
  TRIAL: 'On trial',
  OVERDUE: 'Overdue',
  CANCELLED: 'Cancelled',
} as const;

const STATUS_LABELS: Record<string, string> = {
  COMPLETED: 'Received',
  PENDING: 'Not finished',
  FAILED: 'Failed',
  REVERSED: 'Reversed',
};
export const paymentStatusLabel = (status: string) => STATUS_LABELS[status] ?? status;

/** "November 2026" (long) or "Nov 26" (short, for chart labels), from "2026-11". */
export function monthLabel(month: string, style: 'long' | 'short'): string {
  const date = new Date(`${month}-01T12:00:00Z`);
  return style === 'long'
    ? date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

/** Change against last month as a fraction; null when last month had nothing to compare with. */
export function receivedChange(now: number, before: number): number | null {
  if (before === 0) return now === 0 ? 0 : null;
  return (now - before) / before;
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Kampala' });

/** The period a payment paid for, as far as it is known. */
export function periodText(start: string | null, end: string | null): string {
  if (start && end) return `${day(start)} - ${day(end)}`;
  if (end) return `until ${day(end)}`;
  return '-';
}
