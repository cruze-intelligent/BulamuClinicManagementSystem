import { prisma } from './prisma';

/**
 * Usage tracking for the platform operator's analytics: which staff were active
 * on which day, when each was last seen, and how sign-ins went. It records THAT
 * someone used the app - never what they looked at or changed.
 *
 * It sits on the authentication path of every request, so it must cost almost
 * nothing: writes are throttled in memory (a user's last-seen time at most every
 * ten minutes, and one "active today" row per user per day), run after the
 * request is already being served, and can never fail a request.
 */

const SEEN_INTERVAL_MS = 10 * 60 * 1000;
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000; // East Africa Time, UTC+3, no daylight saving

const lastSeenWrittenAt = new Map<string, number>();
const dayWritten = new Map<string, string>();

// Tests exercise this on purpose; everywhere else in the test suite it stays
// off so a stray background write can't land between one test's reset and the next.
let enabled = process.env.NODE_ENV !== 'test';

export function setUsageTrackingEnabled(value: boolean) {
  enabled = value;
  lastSeenWrittenAt.clear();
  dayWritten.clear();
}

/** The calendar day (YYYY-MM-DD) in East Africa Time - the users' own "today". */
export function eastAfricaDay(at: Date = new Date()): string {
  return new Date(at.getTime() + EAT_OFFSET_MS).toISOString().slice(0, 10);
}

export function trackUserActivity(user: { id: string; clinicId: string }, at: Date = new Date()): void {
  if (!enabled || !user.id || !user.clinicId) return;

  const now = at.getTime();
  const day = eastAfricaDay(at);
  const needSeen = now - (lastSeenWrittenAt.get(user.id) ?? 0) >= SEEN_INTERVAL_MS;
  const needDay = dayWritten.get(user.id) !== day;
  if (!needSeen && !needDay) return;
  if (needSeen) lastSeenWrittenAt.set(user.id, now);
  if (needDay) dayWritten.set(user.id, day);

  void (async () => {
    try {
      // Raw so the user's own updatedAt is not bumped every few minutes.
      if (needSeen) await prisma.$executeRaw`UPDATE "User" SET "lastSeenAt" = ${at} WHERE "id" = ${user.id}`;
      if (needDay) {
        await prisma.userActivityDay.createMany({
          data: [{ userId: user.id, clinicId: user.clinicId, day: new Date(`${day}T00:00:00.000Z`) }],
          skipDuplicates: true,
        });
      }
    } catch {
      // Best effort: forget what we thought we wrote so the next request retries.
      if (needSeen) lastSeenWrittenAt.delete(user.id);
      if (needDay) dayWritten.delete(user.id);
    }
  })();
}

/** Records how a staff sign-in went. Never throws, never delays the sign-in. */
export function recordLoginEvent(
  user: { id: string; clinicId: string },
  outcome: 'SUCCESS' | 'WRONG_PASSWORD' | 'BLOCKED'
): void {
  if (!enabled) return;
  void (async () => {
    try {
      await prisma.loginEvent.create({ data: { userId: user.id, clinicId: user.clinicId, outcome } });
      if (outcome === 'SUCCESS') {
        await prisma.$executeRaw`UPDATE "User" SET "lastLoginAt" = ${new Date()} WHERE "id" = ${user.id}`;
      }
    } catch {
      // analytics only
    }
  })();
  if (outcome === 'SUCCESS') trackUserActivity(user);
}

/** Usage records older than this are deleted (13 months, plus a little slack). */
export const USAGE_RETENTION_DAYS = 400;

export async function purgeOldUsageRecords(now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - USAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.userActivityDay.deleteMany({ where: { day: { lt: cutoff } } });
  await prisma.loginEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
}
