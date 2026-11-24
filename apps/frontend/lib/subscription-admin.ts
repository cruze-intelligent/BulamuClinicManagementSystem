import { shortDate } from '@/lib/finance';

// Payments recorded by hand and grace days, by a Bulamu administrator. The rules
// match apps/backend/src/lib/subscription-admin.ts, which has the final say.

export const MAX_GRACE_DAYS = 7;
export const MAX_CASH_MONTHS = 12;

export type BillingFacility = {
  id: string;
  name: string;
  facilityCode: string;
  subscription: {
    status: string;
    amount: number;
    currency?: string;
    trialEndsAt: string;
    currentPeriodEnd: string | null;
    lastPaymentAt?: string | null;
    graceDays?: number;
    graceFrom?: string | null;
  } | null;
};

export type PaymentMethod = 'CASH' | 'MOBILE_MONEY' | 'BANK_TRANSFER' | 'PESAPAL';
export type CashForm = {
  facilityId: string; months: string; amount: string; paidBy: string; reference: string;
  method?: PaymentMethod; provider?: string; pesapalPaymentId?: string;
};
/** A Pesapal payment still waiting for Pesapal's confirmation. */
export type PendingPesapal = { id: string; clinicId: string; amount: number; currency: string; months: number; createdAt: string; pesapalOrderTrackingId: string | null };

export const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string; reference: string; referenceRequired: boolean }> = [
  { value: 'CASH', label: 'Cash', reference: 'Receipt book number', referenceRequired: false },
  { value: 'MOBILE_MONEY', label: 'Mobile money', reference: 'Transaction ID', referenceRequired: true },
  { value: 'BANK_TRANSFER', label: 'Bank transfer', reference: 'Bank reference', referenceRequired: true },
  { value: 'PESAPAL', label: 'Pesapal - paid, but not confirmed yet', reference: 'Pesapal confirmation code', referenceRequired: false },
];
export const MOBILE_MONEY_NETWORKS = ['MTN Mobile Money', 'Airtel Money'];
export const methodOf = (form: CashForm) => PAYMENT_METHODS.find((m) => m.value === (form.method ?? 'CASH'))!;

export const money = (currency: string, amount: number) => `${currency} ${amount.toLocaleString('en-US')}`;

/** Shillings typed with or without commas and spaces, or NaN. */
export const shillings = (typed: string) => (/^[\d,\s]+$/.test(typed.trim()) ? Number(typed.replace(/[,\s]/g, '')) : NaN);

/** What is wrong with the payment form, in the words the administrator sees - or null. */
export function cashProblem(form: CashForm, facility: BillingFacility | undefined, pending: PendingPesapal[] = []): string | null {
  if (!facility?.subscription) return 'Choose the facility that paid';
  const method = methodOf(form);
  if (method.value === 'PESAPAL') {
    const waiting = pending.find((p) => p.id === form.pesapalPaymentId && p.clinicId === facility.id);
    if (!waiting) return 'Choose the Pesapal payment that is waiting to be confirmed';
    if (form.paidBy.trim().length < 2) return 'Enter who paid (a name, or the number it came from)';
    return null;
  }
  if (method.value === 'MOBILE_MONEY' && !MOBILE_MONEY_NETWORKS.includes(form.provider ?? '')) return 'Choose the mobile money network';
  if (method.referenceRequired && !form.reference.trim()) return `Enter the ${method.reference.toLowerCase()} - it is how the payment is traced`;
  const months = Number(form.months);
  const expected = facility.subscription.amount * months;
  const currency = facility.subscription.currency ?? 'UGX';
  const amount = shillings(form.amount);
  if (!Number.isInteger(amount) || amount <= 0) return method.value === 'CASH' ? 'Enter the amount of cash received' : 'Enter the amount received';
  if (amount !== expected) {
    return `${months === 1 ? '1 month' : `${months} months`} at ${money(currency, facility.subscription.amount)} is ${money(currency, expected)} - ${method.value === 'CASH' ? 'check the cash counted' : 'check the amount received'}`;
  }
  if (form.paidBy.trim().length < 2) return method.value === 'CASH' ? 'Enter the name of the person who handed over the cash' : 'Enter who paid (a name, or the number it came from)';
  return null;
}

/** A paid facility whose period has ended (or is in grace) - the ones grace days are for. */
export function graceCandidate(facility: BillingFacility, now = Date.now()): boolean {
  const s = facility.subscription;
  if (!s || !s.lastPaymentAt || s.status === 'CANCELLED') return false;
  if (s.status === 'PAST_DUE') return true;
  if ((s.graceDays ?? 0) > 0) return true;
  return s.status === 'ACTIVE' && !!s.currentPeriodEnd && new Date(s.currentPeriodEnd).getTime() < now;
}

/** One line on where the facility stands: ended when, or in grace until when. */
export function graceStatus(facility: BillingFacility, now = Date.now()): string {
  const s = facility.subscription!;
  const used = s.graceDays ?? 0;
  const end = s.currentPeriodEnd ? new Date(s.currentPeriodEnd) : null;
  if (used > 0 && end && end.getTime() > now) return `In grace until ${shortDate(end.toISOString())} - ${used} of ${MAX_GRACE_DAYS} days given`;
  if (used > 0) return `Grace ran out${end ? ` ${shortDate(end.toISOString())}` : ''} - ${used} of ${MAX_GRACE_DAYS} days given`;
  return end ? `Paid period ended ${shortDate(end.toISOString())}` : 'Paid period ended';
}
