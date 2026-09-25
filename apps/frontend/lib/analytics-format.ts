// Pure formatting/scaling helpers for the super-admin analytics page.

export type Point = { date: string; value: number };

export const formatNumber = (n: number) => new Intl.NumberFormat('en-UG').format(Math.round(n));

/** 1.2k / 3.4M for axis labels and tiles where space is tight. */
export function compactNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (abs >= 10_000) return `${trim(n / 1_000)}k`;
  return formatNumber(n);
}
const trim = (n: number) => String(Math.round(n * 10) / 10);

export const formatPercent = (share: number | null | undefined) => (share == null ? '-' : `${Math.round(share * 100)}%`);

/** "+12%" / "-8%" / "no change"; null when there is nothing earlier to compare with. */
export function formatChange(change: number | null | undefined): string | null {
  if (change == null) return null;
  const pct = Math.round(change * 100);
  if (pct === 0) return 'no change';
  return `${pct > 0 ? '+' : '-'}${Math.abs(pct)}%`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** "3 hours ago" style label; "never" for null. */
export function timeAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  if (d < 60) return `${d} day${d === 1 ? '' : 's'} ago`;
  return `${Math.floor(d / 30)} months ago`;
}

/** "26 Sep" for a YYYY-MM-DD day (no timezone shifts: the date is already the user's local day). */
export function shortDay(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]}`;
}

/** A round upper bound for an axis so gridlines land on tidy numbers. */
export function niceMax(max: number): number {
  if (max <= 0) return 4;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const f = max / pow;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 4 ? 4 : f <= 5 ? 5 : 10;
  return Math.max(4, nice * pow);
}

export const totalOf = (points: Point[]) => points.reduce((s, p) => s + p.value, 0);

const ENGAGEMENT_ORDER: Record<string, number> = { ACTIVE: 0, NEW: 1, QUIET: 2, DORMANT: 3, NEVER_USED: 4 };
export const engagementRank = (status: string) => ENGAGEMENT_ORDER[status] ?? 9;

export const ENGAGEMENT_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  NEW: 'New',
  QUIET: 'Quiet',
  DORMANT: 'Dormant',
  NEVER_USED: 'Never used',
};

export function humanize(key: string): string {
  return key.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
