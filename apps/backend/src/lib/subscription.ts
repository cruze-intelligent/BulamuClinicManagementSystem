import { prisma } from './prisma';

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map<string, { blocked: boolean; expiresAt: number }>();

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

  let status = subscription.status;
  const now = new Date();
  const trialLapsed = status === 'TRIALING' && subscription.trialEndsAt < now;
  const periodLapsed = status === 'ACTIVE' && subscription.currentPeriodEnd !== null && subscription.currentPeriodEnd < now;

  if (trialLapsed || periodLapsed) {
    status = 'PAST_DUE';
    await prisma.subscription.update({ where: { clinicId }, data: { status: 'PAST_DUE' } });
  }

  const blocked = status === 'PAST_DUE' || status === 'CANCELLED';
  cache.set(clinicId, { blocked, expiresAt: Date.now() + CACHE_TTL_MS });
  return { blocked };
}

export function invalidateSubscriptionCache(clinicId: string) {
  cache.delete(clinicId);
}
