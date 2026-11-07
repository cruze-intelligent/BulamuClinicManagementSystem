import { Prisma } from '@prisma/client';
import { prisma, isUniqueConstraintError } from './prisma';
import { REAL_FACILITY } from './facility';
import { invalidateSubscriptionCache, lapseIfDue, paidPeriodEnd, paidSubscription, SUBSCRIPTION_PERIOD_MS } from './subscription';
import { formatEmailDate } from './mailer';

// What a Bulamu administrator can do about a facility's subscription by hand:
// record cash handed over on a visit, and give a paid facility whose period
// ran out a few days' grace to arrange payment.

/** The most grace days a paid facility may have before it pays again. */
export const MAX_GRACE_DAYS = 7;
/** The most months one cash payment may cover. */
export const MAX_CASH_MONTHS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

export class SubscriptionAdminError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

const money = (currency: string, amount: number) => `${currency} ${amount.toLocaleString('en-US')}`;

async function findFacility(clinicId: string) {
  const clinic = await prisma.clinic.findFirst({
    where: { id: clinicId, ...REAL_FACILITY, registrationStatus: 'APPROVED' },
    include: { subscription: true },
  });
  if (!clinic || !clinic.subscription) throw new SubscriptionAdminError(404, 'Facility not found');
  return { clinic, subscription: clinic.subscription };
}

const lockSubscription = (tx: Prisma.TransactionClient, id: string) =>
  tx.$queryRaw`SELECT id FROM "Subscription" WHERE id = ${id} FOR UPDATE`;

function parseCash(body: unknown) {
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const months = input.months === undefined ? 1 : Number(input.months);
  if (!Number.isInteger(months) || months < 1 || months > MAX_CASH_MONTHS) {
    throw new SubscriptionAdminError(400, `Choose between 1 and ${MAX_CASH_MONTHS} months`);
  }
  const amount = typeof input.amount === 'string' ? Number(input.amount.replace(/[,\s]/g, '')) : Number(input.amount);
  if (!Number.isInteger(amount) || amount <= 0) throw new SubscriptionAdminError(400, 'Enter the amount of cash received, in whole shillings');
  const paidBy = typeof input.paidBy === 'string' ? input.paidBy.trim().replace(/\s+/g, ' ') : '';
  if (paidBy.length < 2) throw new SubscriptionAdminError(400, 'Enter the name of the person who handed over the cash - it is printed on the receipt');
  if (paidBy.length > 100) throw new SubscriptionAdminError(400, 'The name of the person who paid must be at most 100 characters');
  const reference = typeof input.reference === 'string' && input.reference.trim() ? input.reference.trim().slice(0, 60) : null;
  const requestKey = typeof input.requestKey === 'string' && input.requestKey.trim() ? input.requestKey.trim().slice(0, 100) : null;
  return { months, amount, paidBy, reference, requestKey };
}

/**
 * Cash a facility handed to a Bulamu administrator: recorded as a completed
 * payment at this moment (the receipt shows the date and time), and the
 * subscription is paid through the new period exactly as a Pesapal payment
 * would make it. The amount must be what the months cost, which catches a
 * mistyped figure. Sending the same requestKey again (a double click, a retry
 * on a bad connection) returns the payment already recorded.
 */
export async function recordCashPayment(input: { clinicId: string; recordedBy: string; body: unknown; now?: Date }) {
  const now = input.now ?? new Date();
  const cash = parseCash(input.body);

  if (cash.requestKey) {
    const earlier = await prisma.payment.findUnique({ where: { requestKey: cash.requestKey } });
    if (earlier && earlier.clinicId === input.clinicId) return { payment: earlier, repeated: true };
  }

  const { subscription } = await findFacility(input.clinicId);
  const expected = subscription.amount * cash.months;
  if (subscription.amount <= 0) throw new SubscriptionAdminError(409, 'This facility\'s plan has no monthly charge, so there is no payment to record');
  if (cash.amount !== expected) {
    const months = cash.months === 1 ? '1 month' : `${cash.months} months`;
    throw new SubscriptionAdminError(400, `${months} at ${money(subscription.currency, subscription.amount)} a month is ${money(subscription.currency, expected)}, not ${money(subscription.currency, cash.amount)}. Check the cash, or change the facility's plan first if a different price was agreed.`);
  }

  try {
    const payment = await prisma.$transaction(async (tx) => {
      await lockSubscription(tx, subscription.id);
      const current = await tx.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      const periodEnd = paidPeriodEnd(current, now, cash.months);
      const periodStart = new Date(periodEnd.getTime() - cash.months * SUBSCRIPTION_PERIOD_MS);
      const created = await tx.payment.create({
        data: {
          clinicId: input.clinicId, subscriptionId: subscription.id, amount: cash.amount, currency: current.currency, status: 'COMPLETED',
          method: 'CASH', recordedBy: input.recordedBy, paidBy: cash.paidBy, reference: cash.reference, requestKey: cash.requestKey,
          months: cash.months, periodStart, periodEnd, createdAt: now,
        },
      });
      await tx.subscription.update({ where: { id: subscription.id }, data: paidSubscription(periodEnd, now) });
      return created;
    }, { timeout: 15000 });
    invalidateSubscriptionCache(input.clinicId);
    return { payment, repeated: false };
  } catch (error) {
    // The same form sent twice at the same moment: the first one recorded it.
    if (cash.requestKey && isUniqueConstraintError(error)) {
      const earlier = await prisma.payment.findUnique({ where: { requestKey: cash.requestKey } });
      if (earlier?.clinicId === input.clinicId) return { payment: earlier, repeated: true };
      throw new SubscriptionAdminError(409, 'This form was already used for another payment - reload the page and enter it again');
    }
    throw error;
  }
}

/**
 * Grace days for a facility that has paid before and whose paid period has
 * run out: it can keep working for up to MAX_GRACE_DAYS in all while it
 * arranges payment. The days are lent - the next payment's period starts from
 * when the grace began (see paidPeriodEnd) - and they reset once it pays.
 */
export async function giveGraceDays(input: { clinicId: string; days: unknown; now?: Date }) {
  const now = input.now ?? new Date();
  const days = Number(input.days);
  if (!Number.isInteger(days) || days < 1 || days > MAX_GRACE_DAYS) throw new SubscriptionAdminError(400, `Choose between 1 and ${MAX_GRACE_DAYS} days`);

  const { clinic, subscription } = await findFacility(input.clinicId);
  if (!subscription.lastPaymentAt) {
    throw new SubscriptionAdminError(409, 'This facility has never paid, so it has no paid subscription to give grace on. Extend its free trial instead.');
  }
  const status = await lapseIfDue(subscription, now);
  if (status === 'CANCELLED') throw new SubscriptionAdminError(409, 'This subscription is cancelled');
  const inGrace = status === 'ACTIVE' && subscription.graceDays > 0;
  if (status !== 'PAST_DUE' && !inGrace) {
    const until = subscription.currentPeriodEnd ? ` until ${formatEmailDate(subscription.currentPeriodEnd)}` : '';
    throw new SubscriptionAdminError(409, `${clinic.name} is paid${until}. Grace days are only for after a paid subscription runs out.`);
  }
  const remaining = MAX_GRACE_DAYS - subscription.graceDays;
  if (days > remaining) {
    throw new SubscriptionAdminError(409, remaining <= 0
      ? `${clinic.name} has already had the full ${MAX_GRACE_DAYS} grace days. It needs to pay to keep working.`
      : `At most ${remaining} more grace day${remaining === 1 ? '' : 's'} can be given (${MAX_GRACE_DAYS} in all before the facility pays).`);
  }

  // In grace already: the days go on the end. Otherwise grace starts today.
  const from = inGrace && subscription.currentPeriodEnd && subscription.currentPeriodEnd > now ? subscription.currentPeriodEnd : now;
  const graceEndsAt = new Date(from.getTime() + days * DAY_MS);
  // Conditional on nothing having changed since it was read, so two quick
  // clicks can never add up to more than the limit.
  const { count } = await prisma.subscription.updateMany({
    where: { id: subscription.id, graceDays: subscription.graceDays, status },
    data: { status: 'ACTIVE', currentPeriodEnd: graceEndsAt, graceDays: { increment: days }, graceFrom: subscription.graceFrom ?? now },
  });
  if (count !== 1) throw new SubscriptionAdminError(409, 'The subscription changed a moment ago - reload and try again');
  invalidateSubscriptionCache(input.clinicId);
  return { clinic, subscriptionId: subscription.id, days, graceEndsAt, graceDays: subscription.graceDays + days, remaining: remaining - days };
}
