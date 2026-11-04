// Stock control as the screens show it: what an item's state is, the reasons
// stock can be removed, and checking what is typed before it is sent. The
// server (lib/stock.ts) checks all of it again.

/** Who may change stock. Everyone else sees it read-only. */
export const STOCK_ROLES = ['ADMIN', 'PHARMACIST'];

export const REMOVAL_REASONS = [
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'DAMAGED', label: 'Damaged' },
  { value: 'LOST', label: 'Lost or missing' },
  { value: 'RETURNED', label: 'Returned to the supplier' },
  { value: 'OTHER', label: 'Other' },
] as const;

export const STOCK_UNITS = ['tablets', 'capsules', 'bottles', 'sachets', 'vials', 'ampoules', 'tubes', 'boxes', 'packs', 'pieces', 'ml'];

/** Warned about this many days before an expiry date (the same as the server's alerts). */
export const EXPIRY_WARNING_DAYS = 60;
const DAY = 24 * 60 * 60 * 1000;

type Item = { quantity: number; reorderLevel: number; expiryDate?: string | null; expiredQuantity?: number };

export type StockState = { out: boolean; low: boolean; expired: number; expiringSoon: boolean };

/** Out of stock, at or below the reorder level, how much has expired, and whether something expires within 60 days. */
export function stockState(item: Item, now: Date = new Date()): StockState {
  const expiry = item.expiryDate ? new Date(item.expiryDate).getTime() : null;
  const expired = item.expiredQuantity ?? (expiry !== null && expiry <= now.getTime() ? item.quantity : 0);
  return {
    out: item.quantity <= 0,
    low: item.quantity > 0 && item.quantity <= item.reorderLevel,
    expired,
    expiringSoon: expiry !== null && expiry > now.getTime() && expiry - now.getTime() <= EXPIRY_WARNING_DAYS * DAY,
  };
}

export type StockFilter = 'all' | 'low' | 'expiring' | 'expired';

export function matchesFilter(item: Item & { name: string }, filter: StockFilter, search: string, now: Date = new Date()): boolean {
  const q = search.trim().toLowerCase();
  if (q && !item.name.toLowerCase().includes(q)) return false;
  const state = stockState(item, now);
  if (filter === 'low') return state.out || state.low;
  if (filter === 'expiring') return state.expiringSoon;
  if (filter === 'expired') return state.expired > 0;
  return true;
}

/** "1,000" -> 1000; null for anything that is not a whole number at least `min`. */
export function wholeNumber(text: string, min = 0): number | null {
  const cleaned = text.replace(/[,\s]/g, '');
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return n >= min && n <= 10_000_000 ? n : null;
}

/** The difference a count would record, in words: "3 fewer than recorded", "matches the record". */
export function countDifference(counted: number | null, recorded: number, unit: string): string {
  if (counted === null) return '';
  const diff = counted - recorded;
  if (diff === 0) return 'Matches what is recorded.';
  return `${Math.abs(diff).toLocaleString('en-US')} ${unit} ${diff < 0 ? 'fewer' : 'more'} than recorded (${recorded.toLocaleString('en-US')}).`;
}

/** "+1,000" / "-20" / "0". */
export const signed = (n: number) => (n > 0 ? `+${n.toLocaleString('en-US')}` : n.toLocaleString('en-US'));
