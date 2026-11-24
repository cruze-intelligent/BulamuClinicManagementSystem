import { Prisma } from '@prisma/client';
import { prisma, isUniqueConstraintError } from './prisma';
import { REAL_FACILITY } from './facility';
import { invalidateSubscriptionCache, lapseIfDue, paidPeriodEnd, paidSubscription, SUBSCRIPTION_PERIOD_MS } from './subscription';
import { formatEmailDate } from './mailer';

// What a Bulamu administrator can do about a facility's subscription by hand:
// record a payment made outside Pesapal (or confirm one Pesapal is late with),
// and give a paid facility whose period ran out a few days' grace to arrange
// payment.

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

/** The ways a Bulamu administrator can record a subscription payment by hand. */
export const MANUAL_METHODS = ['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'PESAPAL'] as const;
export type ManualMethod = (typeof MANUAL_METHODS)[number];
export const MOBILE_MONEY_NETWORKS = ['MTN Mobile Money', 'Airtel Money'] as const;

/** How each method reads on a receipt, and what its reference is called. */
export const METHOD_WORDS: Record<ManualMethod, { label: string; reference: string }> = {
  CASH: { label: 'Cash', reference: 'Receipt book number' },
  MOBILE_MONEY: { label: 'Mobile money', reference: 'Transaction ID' },
  BANK_TRANSFER: { label: 'Bank transfer', reference: 'Bank reference' },
  PESAPAL: { label: 'Pesapal', reference: 'Pesapal confirmation code' },
};

const cleanText = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '');

function parseManual(body: unknown) {
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const method = (input.method === undefined ? 'CASH' : input.method) as ManualMethod;
  if (!MANUAL_METHODS.includes(method)) throw new SubscriptionAdminError(400, 'Choose how the facility paid');
  const months = input.months === undefined ? 1 : Number(input.months);
  if (!Number.isInteger(months) || months < 1 || months > MAX_CASH_MONTHS) {
    throw new SubscriptionAdminError(400, `Choose between 1 and ${MAX_CASH_MONTHS} months`);
  }
  const amount = typeof input.amount === 'string' ? Number(input.amount.replace(/[,\s]/g, '')) : Number(input.amount);
  if (!Number.isInteger(amount) || amount <= 0) throw new SubscriptionAdminError(400, method === 'CASH' ? 'Enter the amount of cash received, in whole shillings' : 'Enter the amount received, in whole shillings');
  const paidBy = typeof input.paidBy === 'string' ? input.paidBy.trim().replace(/\s+/g, ' ') : '';
  if (paidBy.length < 2) {
    throw new SubscriptionAdminError(400, method === 'CASH'
      ? 'Enter the name of the person who handed over the cash - it is printed on the receipt'
      : 'Enter who paid (a name, or the number it came from) - it is printed on the receipt');
  }
  if (paidBy.length > 100) throw new SubscriptionAdminError(400, 'The name of the person who paid must be at most 100 characters');
  const reference = cleanText(input.reference, 60) || null;
  let provider: string | null = null;
  if (method === 'MOBILE_MONEY') {
    provider = MOBILE_MONEY_NETWORKS.find((n) => n === input.provider) ?? null;
    if (!provider) throw new SubscriptionAdminError(400, 'Choose the mobile money network: MTN Mobile Money or Airtel Money');
    if (!reference) throw new SubscriptionAdminError(400, 'Enter the transaction ID from the mobile money message - it is how the payment is traced');
  }
  if (method === 'BANK_TRANSFER') {
    provider = cleanText(input.provider, 60) || null;
    if (!reference) throw new SubscriptionAdminError(400, 'Enter the bank reference of the transfer - it is how the payment is traced');
  }
  const pesapalPaymentId = method === 'PESAPAL' ? cleanText(input.pesapalPaymentId, 64) : '';
  if (method === 'PESAPAL' && !pesapalPaymentId) throw new SubscriptionAdminError(400, 'Choose the Pesapal payment that is waiting to be confirmed');
  const requestKey = typeof input.requestKey === 'string' && input.requestKey.trim() ? input.requestKey.trim().slice(0, 100) : null;
  return { method, provider, months, amount, paidBy, reference, requestKey, pesapalPaymentId };
}

/**
 * A subscription payment a Bulamu administrator records by hand: cash handed
 * over on a visit, mobile money or a bank transfer sent straight to Bulamu -
 * or a Pesapal payment the facility made whose confirmation is late. It is a
 * completed payment at this moment (the receipt shows the date and time), and
 * the subscription is paid through the new period exactly as a Pesapal payment
 * would make it. The amount must be what the months cost, which catches a
 * mistyped figure. Sending the same requestKey again (a double click, a retry
 * on a bad connection) returns the payment already recorded.
 *
 * A late Pesapal payment is confirmed on its own record, not recorded again:
 * when Pesapal's confirmation does arrive, it finds the payment already
 * applied and adds nothing - the facility is never credited twice.
 */
export async function recordManualPayment(input: { clinicId: string; recordedBy: string; body: unknown; now?: Date }) {
  const now = input.now ?? new Date();
  const paid = parseManual(input.body);

  if (paid.requestKey) {
    const earlier = await prisma.payment.findUnique({ where: { requestKey: paid.requestKey } });
    if (earlier && earlier.clinicId === input.clinicId) return { payment: earlier, repeated: true };
  }

  const { subscription } = await findFacility(input.clinicId);
  if (paid.method === 'PESAPAL') return confirmLatePesapal(input.clinicId, subscription.id, paid, input.recordedBy, now);

  const expected = subscription.amount * paid.months;
  if (subscription.amount <= 0) throw new SubscriptionAdminError(409, 'This facility\'s plan has no monthly charge, so there is no payment to record');
  if (paid.amount !== expected) {
    const months = paid.months === 1 ? '1 month' : `${paid.months} months`;
    throw new SubscriptionAdminError(400, `${months} at ${money(subscription.currency, subscription.amount)} a month is ${money(subscription.currency, expected)}, not ${money(subscription.currency, paid.amount)}. Check the amount received, or change the facility's plan first if a different price was agreed.`);
  }

  try {
    const payment = await prisma.$transaction(async (tx) => {
      await lockSubscription(tx, subscription.id);
      const current = await tx.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      const periodEnd = paidPeriodEnd(current, now, paid.months);
      const periodStart = new Date(periodEnd.getTime() - paid.months * SUBSCRIPTION_PERIOD_MS);
      const created = await tx.payment.create({
        data: {
          clinicId: input.clinicId, subscriptionId: subscription.id, amount: paid.amount, currency: current.currency, status: 'COMPLETED',
          method: paid.method, provider: paid.provider, recordedBy: input.recordedBy, paidBy: paid.paidBy, reference: paid.reference, requestKey: paid.requestKey,
          months: paid.months, periodStart, periodEnd, createdAt: now,
        },
      });
      await tx.subscription.update({ where: { id: subscription.id }, data: paidSubscription(periodEnd, now) });
      return created;
    }, { timeout: 15000 });
    invalidateSubscriptionCache(input.clinicId);
    return { payment, repeated: false };
  } catch (error) {
    // The same form sent twice at the same moment: the first one recorded it.
    if (paid.requestKey && isUniqueConstraintError(error)) {
      const earlier = await prisma.payment.findUnique({ where: { requestKey: paid.requestKey } });
      if (earlier?.clinicId === input.clinicId) return { payment: earlier, repeated: true };
      throw new SubscriptionAdminError(409, 'This form was already used for another payment - reload the page and enter it again');
    }
    throw error;
  }
}

/** Kept for pages opened before payments other than cash could be recorded. */
export const recordCashPayment = (input: { clinicId: string; recordedBy: string; body: unknown; now?: Date }) =>
  recordManualPayment({ ...input, body: { ...((input.body && typeof input.body === 'object' ? input.body : {}) as object), method: 'CASH' } });

/** A facility's Pesapal payment still waiting for Pesapal's confirmation, confirmed by hand. */
async function confirmLatePesapal(
  clinicId: string, subscriptionId: string, paid: ReturnType<typeof parseManual>, recordedBy: string, now: Date,
) {
  const waiting = await prisma.payment.findUnique({ where: { id: paid.pesapalPaymentId } });
  if (!waiting || waiting.clinicId !== clinicId || waiting.method !== 'PESAPAL') throw new SubscriptionAdminError(404, 'That Pesapal payment is not this facility\'s');
  if (waiting.status === 'COMPLETED') throw new SubscriptionAdminError(409, 'Pesapal has confirmed this payment already - the facility is paid, there is nothing to record');
  if (waiting.status !== 'PENDING') throw new SubscriptionAdminError(409, 'Pesapal reported this payment as failed or reversed. If the facility did pay, record it the way the money actually came (mobile money, bank, cash) with its reference.');
  if (paid.amount !== waiting.amount) throw new SubscriptionAdminError(400, `That Pesapal payment was for ${money(waiting.currency, waiting.amount)}, not ${money(waiting.currency, paid.amount)}`);

  const payment = await prisma.$transaction(async (tx) => {
    await lockSubscription(tx, subscriptionId);
    const current = await tx.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    const periodEnd = paidPeriodEnd(current, now, waiting.months);
    const periodStart = new Date(periodEnd.getTime() - waiting.months * SUBSCRIPTION_PERIOD_MS);
    // Conditional: if Pesapal's own confirmation lands at this very moment, only one of them applies it.
    const { count } = await tx.payment.updateMany({
      where: { id: waiting.id, status: 'PENDING' },
      data: { status: 'COMPLETED', recordedBy, paidBy: paid.paidBy, reference: paid.reference, requestKey: paid.requestKey, periodStart, periodEnd },
    });
    if (count !== 1) throw new SubscriptionAdminError(409, 'Pesapal has confirmed this payment already - the facility is paid, there is nothing to record');
    await tx.subscription.update({ where: { id: subscriptionId }, data: paidSubscription(periodEnd, now) });
    return tx.payment.findUniqueOrThrow({ where: { id: waiting.id } });
  }, { timeout: 15000 });
  invalidateSubscriptionCache(clinicId);
  return { payment, repeated: false };
}

/** Pesapal payments still waiting for Pesapal's confirmation, newest first - for the Bulamu administrator. */
export function pendingPesapalPayments() {
  return prisma.payment.findMany({
    where: { method: 'PESAPAL', status: 'PENDING', amount: { gt: 0 } },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, clinicId: true, amount: true, currency: true, months: true, createdAt: true, pesapalOrderTrackingId: true },
  });
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
