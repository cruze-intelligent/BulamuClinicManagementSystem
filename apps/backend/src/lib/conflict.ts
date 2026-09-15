import { prisma } from './prisma';

/**
 * Deterministic conflict resolution per the research doc: when a synced
 * mutation's timestamp is older than what's already stored, the older write
 * loses (true last-write-WINS by timestamp, not by arrival order) and the
 * discard is logged instead of silently applied, so staff can review it on
 * the Sync Activity panel rather than losing data with no trace.
 *
 * Returns true if the incoming write should be skipped (it was stale).
 */
export async function recordConflictIfStale(input: {
  entity: string;
  recordId: string;
  clinicId: string;
  mutationId: string;
  incomingUpdatedAt: Date;
  currentUpdatedAt: Date | null;
}): Promise<boolean> {
  if (!input.currentUpdatedAt || input.incomingUpdatedAt >= input.currentUpdatedAt) {
    return false;
  }

  await prisma.syncConflictLog.create({
    data: {
      entity: input.entity,
      recordId: input.recordId,
      clinicId: input.clinicId,
      mutationId: input.mutationId,
      incomingUpdatedAt: input.incomingUpdatedAt,
      currentUpdatedAt: input.currentUpdatedAt,
    },
  });

  return true;
}
