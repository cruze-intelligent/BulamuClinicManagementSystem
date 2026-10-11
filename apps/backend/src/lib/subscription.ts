import type { Subscription } from '@prisma/client';
import { prisma } from './prisma';
import { REAL_FACILITY } from './facility';
import { formatEmailDate } from './mailer';
import { alertOperator } from './operator-alerts';

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map<string, { blocked: boolean; expiresAt: number }>();

export const SUBSCRIPTION_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export const SUBSCRIPTION_REQUIRED_MESSAGE =
  "Your facility's subscription has ended, so this can't be saved. Existing records can still be viewed. An administrator can renew it from the Billing page.";

/**
 * Whether a clinic's subscription currently blocks write access. Cached
 * briefly per clinic so this doesn't add a DB round-trip to every request -
 * a lapsed subscription being enforced 60s late is an acceptable trade-off
 * for a rural-facility system where read access must never lag.
 */
export async function getSubscriptionGate(clinicId: string): Promise<{ blocked: boolean }> {
  const cached = cache.get(clinicId);
  if (cached && cached.expiresAt > Date.now()) {
    return { blocked: cached.blocked };
  }

  const subscription = await prisma.subscription.findUnique({ where: { clinicId } });

  // An approved clinic should always have a subscription row (created at
  // approval time) - fail closed rather than open if one is ever missing.
  if (!subscription) {
    cache.set(clinicId, { blocked: true, expiresAt: Date.now() + CACHE_TTL_MS });
    return { blocked: true };
  }

  const status = await lapseIfDue(subscription);
  const blocked = status === 'PAST_DUE' || status === 'CANCELLED';
  cache.set(clinicId, { blocked, expiresAt: Date.now() + CACHE_TTL_MS });
  return { blocked };
}

export function invalidateSubscriptionCache(clinicId: string) {
  cache.delete(clinicId);
}

/**
 * Moves a trial or paid period whose end date has passed to PAST_DUE, and
 * returns the (possibly new) status. The update is conditional on the status
 * not having changed, so whichever caller gets there first - the write gate,
 * the billing page or the background sweep - is the one that alerts the
 * operator, exactly once per lapse.
 */
export async function lapseIfDue(subscription: Subscription, now: Date = new Date()): Promise<Subscription['status']> {
  const trialLapsed = subscription.status === 'TRIALING' && subscription.trialEndsAt < now;
  const periodLapsed = subscription.status === 'ACTIVE' && subscription.currentPeriodEnd !== null && subscription.currentPeriodEnd < now;
  if (!trialLapsed && !periodLapsed) return subscription.status;

  const { count } = await prisma.subscription.updateMany({
    where: { id: subscription.id, status: subscription.status },
    data: { status: 'PAST_DUE' },
  });
  invalidateSubscriptionCache(subscription.clinicId);
  if (count === 1) void alertOperatorOfLapse(subscription, trialLapsed);
  return 'PAST_DUE';
}

async function alertOperatorOfLapse(subscription: Subscription, wasTrial: boolean): Promise<void> {
  try {
    const clinic = await prisma.clinic.findFirst({
      where: { id: subscription.clinicId, ...REAL_FACILITY },
      include: { users: { where: { role: 'ADMIN' }, select: { name: true, email: true }, take: 1 } },
    });
    // Internal and removed facilities are nobody's customers.
    if (!clinic) return;
    const ended = wasTrial ? subscription.trialEndsAt : subscription.currentPeriodEnd;
    const admin = clinic.users[0];
    await alertOperator({
      subject: `${wasTrial ? 'Trial ended unpaid' : 'Subscription lapsed'} - ${clinic.name}`,
      heading: wasTrial ? 'A free trial ended without payment' : 'A paid subscription lapsed without renewal',
      intro: 'The facility can still sign in and view its records, but cannot save new ones until it pays. It may be worth a call.',
      facts: [
        ['Facility', clinic.name],
        ['Facility ID', clinic.facilityCode],
        [wasTrial ? 'Trial ended' : 'Period ended', ended ? formatEmailDate(ended) : null],
        ['Facility phone', clinic.phone],
        ['Administrator', admin ? `${admin.name} (${admin.email})` : null],
        ['Monthly amount', `${subscription.currency} ${subscription.amount.toLocaleString()}`],
      ],
      ctaPath: '/super-admin',
      ctaLabel: 'Open Facility Management',
    });
  } catch {
    // The lapse itself is recorded; a failed alert email is not worth failing over.
  }
}

/**
 * Finds every trial or paid period that has ended and marks it PAST_DUE, so
 * the platform figures are right and the operator hears about it even when
 * nobody at the facility has tried to save anything since. Never throws.
 */
export async function sweepLapsedSubscriptions(now: Date = new Date()): Promise<number> {
  try {
    const due = await prisma.subscription.findMany({
      where: {
        OR: [
          { status: 'TRIALING', trialEndsAt: { lt: now } },
          { status: 'ACTIVE', currentPeriodEnd: { lt: now } },
        ],
      },
    });
    for (const subscription of due) await lapseIfDue(subscription, now);
    return due.length;
  } catch {
    return 0;
  }
}

/**
 * When a newly paid period ends. Paying before the trial or the current
 * period is over adds the 30 days on top of what is left, so paying early
 * never costs the facility days it already had.
 */
export function paidPeriodEnd(subscription: Pick<Subscription, 'status' | 'trialEndsAt' | 'currentPeriodEnd'>, now: Date = new Date()): Date {
  let start = now;
  if (subscription.status === 'TRIALING' && subscription.trialEndsAt > start) start = subscription.trialEndsAt;
  if (subscription.status === 'ACTIVE' && subscription.currentPeriodEnd && subscription.currentPeriodEnd > start) start = subscription.currentPeriodEnd;
  return new Date(start.getTime() + SUBSCRIPTION_PERIOD_MS);
}
