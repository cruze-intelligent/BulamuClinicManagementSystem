import { prisma } from './prisma';
import { AuditAction } from '@prisma/client';

/**
 * Writes an audit trail entry for the sensitive record categories the
 * research doc's security section calls out (HIV/TB-adjacent clinical data,
 * financials): Patient, ReproductiveHealthRecord, User, Invoice.
 */
export async function recordAudit(input: {
  entity: string;
  recordId: string;
  clinicId: string;
  action: AuditAction;
  actorUserId: string;
  actorRole: string;
  metadata?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      entity: input.entity,
      recordId: input.recordId,
      clinicId: input.clinicId,
      action: input.action,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      metadata: input.metadata as any,
    },
  });
}
