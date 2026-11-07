import type { Payment, Subscription } from '@prisma/client';
import { prisma } from './prisma';
import { REAL_FACILITY } from './facility';
import { eastAfricaDay } from './usage-tracking';

/**
 * Bulamu's own money, for the platform operator: the subscriptions facilities
 * pay through Pesapal, or in cash to a Bulamu administrator. Facilities' patient bills are their money, not
 * Bulamu's, and never appear here. Months are East Africa months; a payment
 * counts on the day Pesapal confirmed it (when it was marked completed), the
 * same date its receipt shows. Free-trial receipts (UGX 0) are not income and
 * are left out. Demo facilities and the operator's own account never count.
 */

const EAT = '+03:00';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Upcoming renewals are looked for this far ahead, ending trials half that. */
export const DUE_WINDOW_DAYS = 30;
export const TRIAL_WINDOW_DAYS = 14;
/** The newest payments listed on the page; the CSV export has every one. */
export const PAYMENT_LIST_LIMIT = 200;

/** The 'YYYY-MM' month `offset` months from `month`. */
export function shiftMonth(month: string, offset: number): string {
  const [year, m] = month.split('-').map(Number);
  return new Date(Date.UTC(year, m - 1 + offset, 1)).toISOString().slice(0, 7);
}

const monthStart = (month: string) => new Date(`${month}-01T00:00:00${EAT}`);

/** Money received: completed payments of more than nothing, from real facilities. */
const RECEIVED = { status: 'COMPLETED' as const, amount: { gt: 0 }, clinic: { is: REAL_FACILITY } };

type SubscriptionDates = Pick<Subscription, 'status' | 'trialEndsAt' | 'currentPeriodEnd'>;

/** When what the facility has (its trial, or the period it paid for) runs out; null when no end was ever recorded. */
export function coveredUntil(s: SubscriptionDates): Date | null {
  if (s.status === 'TRIALING') return s.trialEndsAt;
  return s.currentPeriodEnd ?? null;
}

/**
 * Where a facility stands on money. A period that has run out counts as
 * overdue at once, even in the hour before the lapse sweep marks it past due.
 */
export function paymentStanding(s: SubscriptionDates, now: Date = new Date()): 'PAID' | 'TRIAL' | 'OVERDUE' | 'CANCELLED' {
  if (s.status === 'CANCELLED') return 'CANCELLED';
  if (s.status === 'PAST_DUE') return 'OVERDUE';
  const until = coveredUntil(s);
  if (until && until < now) return 'OVERDUE';
  return s.status === 'TRIALING' ? 'TRIAL' : 'PAID';
}

export async function buildPlatformFinances(now: Date = new Date()) {
  const thisMonth = eastAfricaDay(now).slice(0, 7);
  const lastMonth = shiftMonth(thisMonth, -1);
  const firstSeriesMonth = shiftMonth(thisMonth, -11);
  const yearStart = new Date(`${thisMonth.slice(0, 4)}-01-01T00:00:00${EAT}`);

  const [allTime, thisYear, lastTwelveMonths, reversed, pending, subscriptions, paidByFacility, recentPayments] = await Promise.all([
    prisma.payment.aggregate({ where: RECEIVED, _sum: { amount: true }, _count: true }),
    prisma.payment.aggregate({ where: { ...RECEIVED, updatedAt: { gte: yearStart } }, _sum: { amount: true }, _count: true }),
    prisma.payment.findMany({ where: { ...RECEIVED, updatedAt: { gte: monthStart(firstSeriesMonth) } }, select: { amount: true, updatedAt: true } }),
    prisma.payment.aggregate({ where: { status: 'REVERSED', amount: { gt: 0 }, clinic: { is: REAL_FACILITY } }, _sum: { amount: true }, _count: true }),
    // Checkouts started and not (yet) finished - often abandoned at Pesapal.
    prisma.payment.count({ where: { status: 'PENDING', amount: { gt: 0 }, clinic: { is: REAL_FACILITY } } }),
    prisma.subscription.findMany({
      where: { clinic: { is: { ...REAL_FACILITY, registrationStatus: 'APPROVED' } } },
      include: { clinic: { select: { id: true, name: true, facilityCode: true, isActive: true } } },
    }),
    prisma.payment.groupBy({ by: ['clinicId'], where: RECEIVED, _sum: { amount: true }, _count: true }),
    prisma.payment.findMany({
      where: { amount: { gt: 0 }, clinic: { is: REAL_FACILITY } },
      orderBy: { createdAt: 'desc' },
      take: PAYMENT_LIST_LIMIT,
      include: { clinic: { select: { id: true, name: true, facilityCode: true } } },
    }),
  ]);

  // Income per month for the last twelve, zero-filled so quiet months show.
  const monthly = Array.from({ length: 12 }, (_, i) => ({ month: shiftMonth(firstSeriesMonth, i), amount: 0, payments: 0 }));
  const byMonth = new Map(monthly.map((m) => [m.month, m]));
  for (const p of lastTwelveMonths) {
    const row = byMonth.get(eastAfricaDay(p.updatedAt).slice(0, 7));
    if (row) {
      row.amount += p.amount;
      row.payments += 1;
    }
  }

  const paid = new Map(paidByFacility.map((p) => [p.clinicId, { total: p._sum.amount ?? 0, count: p._count }]));
  const dueBy = new Date(now.getTime() + DUE_WINDOW_DAYS * DAY_MS);
  const trialsBy = new Date(now.getTime() + TRIAL_WINDOW_DAYS * DAY_MS);

  const facilities = subscriptions
    .map((s) => ({
      id: s.clinic.id,
      name: s.clinic.name,
      facilityCode: s.clinic.facilityCode,
      isActive: s.clinic.isActive,
      plan: s.plan,
      status: s.status,
      standing: paymentStanding(s, now),
      amount: s.amount,
      currency: s.currency,
      coveredUntil: coveredUntil(s),
      lastPaymentAt: s.lastPaymentAt,
      totalPaid: paid.get(s.clinicId)?.total ?? 0,
      payments: paid.get(s.clinicId)?.count ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const sum = (rows: Array<{ amount: number }>) => rows.reduce((total, r) => total + r.amount, 0);
  const byDate = (a: { coveredUntil: Date | null }, b: { coveredUntil: Date | null }) =>
    (a.coveredUntil?.getTime() ?? 0) - (b.coveredUntil?.getTime() ?? 0);
  const paying = facilities.filter((f) => f.standing === 'PAID');
  const dueSoon = paying.filter((f) => f.coveredUntil && f.coveredUntil <= dueBy).sort(byDate);
  const overdue = facilities.filter((f) => f.standing === 'OVERDUE').sort(byDate);
  const trialsEnding = facilities.filter((f) => f.standing === 'TRIAL' && f.coveredUntil && f.coveredUntil <= trialsBy).sort(byDate);

  return {
    currency: subscriptions[0]?.currency ?? 'UGX',
    months: { thisMonth, lastMonth },
    received: {
      thisMonth: byMonth.get(thisMonth)!,
      lastMonth: byMonth.get(lastMonth)!,
      thisYear: { amount: thisYear._sum.amount ?? 0, payments: thisYear._count },
      allTime: { amount: allTime._sum.amount ?? 0, payments: allTime._count },
      reversed: { amount: reversed._sum.amount ?? 0, payments: reversed._count },
      pendingCheckouts: pending,
    },
    monthlyRecurring: { amount: sum(paying), facilities: paying.length },
    expected: {
      dueSoon: { days: DUE_WINDOW_DAYS, amount: sum(dueSoon), facilities: dueSoon },
      overdue: { amount: sum(overdue), facilities: overdue },
      trialsEnding: { days: TRIAL_WINDOW_DAYS, amount: sum(trialsEnding), facilities: trialsEnding },
    },
    monthly,
    facilities,
    payments: recentPayments.map(paymentRow),
    paymentsShown: PAYMENT_LIST_LIMIT,
  };
}

type PaymentWithFacility = Payment & {
  clinic: { id: string; name: string; facilityCode: string };
};

export function paymentRow(p: PaymentWithFacility) {
  return {
    id: p.id,
    facility: p.clinic,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    startedAt: p.createdAt,
    // Completed (or later reversed) payments were confirmed when last updated.
    paidAt: p.status === 'COMPLETED' || p.status === 'REVERSED' ? p.updatedAt : null,
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    method: p.method,
    paidBy: p.paidBy,
    // Pesapal's reference, or the receipt-book number for cash.
    reference: p.pesapalOrderTrackingId ?? p.reference,
    hasReceipt: p.status === 'COMPLETED',
  };
}

/** Every payment of money (not free-trial receipts), newest first, for the CSV export. */
export async function allPayments() {
  const rows = await prisma.payment.findMany({
    where: { amount: { gt: 0 }, clinic: { is: REAL_FACILITY } },
    orderBy: { createdAt: 'desc' },
    include: { clinic: { select: { id: true, name: true, facilityCode: true } } },
  });
  return rows.map(paymentRow);
}
