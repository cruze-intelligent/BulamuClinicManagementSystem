import { shortDate } from '@/lib/finance';

// Cash payments and grace days, recorded by a Bulamu administrator. The rules
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

export type CashForm = { facilityId: string; months: string; amount: string; paidBy: string; reference: string };

export const money = (currency: string, amount: number) => `${currency} ${amount.toLocaleString('en-US')}`;

/** Shillings typed with or without commas and spaces, or NaN. */
export const shillings = (typed: string) => (/^[\d,\s]+$/.test(typed.trim()) ? Number(typed.replace(/[,\s]/g, '')) : NaN);

/** What is wrong with the cash form, in the words the administrator sees - or null. */
export function cashProblem(form: CashForm, facility: BillingFacility | undefined): string | null {
  if (!facility?.subscription) return 'Choose the facility that paid';
  const months = Number(form.months);
  const expected = facility.subscription.amount * months;
  const currency = facility.subscription.currency ?? 'UGX';
  const amount = shillings(form.amount);
  if (!Number.isInteger(amount) || amount <= 0) return 'Enter the amount of cash received';
  if (amount !== expected) {
    return `${months === 1 ? '1 month' : `${months} months`} at ${money(currency, facility.subscription.amount)} is ${money(currency, expected)} - check the cash counted`;
  }
  if (form.paidBy.trim().length < 2) return 'Enter the name of the person who handed over the cash';
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
