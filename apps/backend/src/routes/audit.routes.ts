import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate, resolveClinicScope, getAuthUser } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { buildCsv, sendCsv } from '../lib/csv';

type AuditEntry = {
  id: string;
  entity: string;
  recordId: string;
  clinicId: string;
  action: string;
  actorUserId: string;
  actorRole: string;
  createdAt: Date;
};

/**
 * Resolves a human-readable label for each distinct actor in a batch of audit
 * entries. actorUserId is a plain string, not a foreign key (an actor may be a
 * User or, for patient-portal actions, a PatientAccount), so this looks both
 * tables up rather than joining. A patient actor is labelled by their portable
 * ID, never their name - the same convention already used wherever a
 * patient-uploaded document is attributed on screen.
 */
async function resolveActorNames(entries: AuditEntry[]): Promise<Map<string, string>> {
  const staffIds = [...new Set(entries.filter((e) => e.actorRole !== 'PATIENT').map((e) => e.actorUserId))];
  const patientIds = [...new Set(entries.filter((e) => e.actorRole === 'PATIENT').map((e) => e.actorUserId))];

  const [users, patients] = await Promise.all([
    staffIds.length ? prisma.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true, email: true } }) : [],
    patientIds.length ? prisma.patientAccount.findMany({ where: { id: { in: patientIds } }, select: { id: true, portableId: true } }) : [],
  ]);

  const names = new Map<string, string>();
  for (const u of users) names.set(u.id, `${u.name} (${u.email})`);
  for (const p of patients) names.set(p.id, `Patient ${p.portableId}`);
  return names;
}

function withActorNames<T extends AuditEntry>(entries: T[], names: Map<string, string>) {
  return entries.map((e) => ({ ...e, actorName: names.get(e.actorUserId) || null }));
}

const AUDIT_CSV_COLUMNS: Array<[string, (row: any) => unknown]> = [
  ['Date/time', (r) => r.createdAt],
  ['Action', (r) => r.action],
  ['Entity', (r) => r.entity],
  ['Record ID', (r) => r.recordId],
  ['Facility', (r) => r.clinicName || ''],
  ['Actor role', (r) => r.actorRole],
  ['Actor', (r) => r.actorName || r.actorUserId],
];

// The export cap is far above the 200-row on-screen feed - high enough to be
// a genuine "whole" export for a facility's or the platform's history, while
// still bounded so a runaway request can't pull the entire table unbounded.
const EXPORT_ROW_LIMIT = 20000;
const FEED_ROW_LIMIT = 200;

async function withClinicNames<T extends { clinicId: string }>(entries: T[]) {
  const clinics = await prisma.clinic.findMany({
    where: { id: { in: [...new Set(entries.map((e) => e.clinicId))] } },
    select: { id: true, name: true, facilityCode: true },
  });
  const clinicById = new Map(clinics.map((c) => [c.id, c]));
  return entries.map((e) => ({ ...e, clinicName: clinicById.get(e.clinicId) ? `${clinicById.get(e.clinicId)!.name} (${clinicById.get(e.clinicId)!.facilityCode})` : 'Unknown facility' }));
}

export async function auditRoutes(fastify: FastifyInstance) {
  // Every role's own activity, scoped to their own actions in their own
  // facility - never another user's, and never another facility's.
  fastify.get('/audit-log/me', { preHandler: [authenticate] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    try {
      const entries = await prisma.auditLog.findMany({
        where: { clinicId: authUser.clinicId, actorUserId: authUser.userId },
        orderBy: { createdAt: 'desc' },
        take: FEED_ROW_LIMIT,
      });
      const names = await resolveActorNames(entries);
      return { success: true, entries: withActorNames(entries, names) };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // The caller's own activity as a CSV download - the "export my activity"
  // action available to every role, not just ADMIN/SUPER_ADMIN.
  fastify.get('/audit-log/me/export', { preHandler: [authenticate] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    try {
      const entries = await prisma.auditLog.findMany({
        where: { clinicId: authUser.clinicId, actorUserId: authUser.userId },
        orderBy: { createdAt: 'desc' },
        take: EXPORT_ROW_LIMIT,
      });
      const [withClinic, names] = await Promise.all([withClinicNames(entries), resolveActorNames(entries)]);
      const csv = buildCsv(AUDIT_CSV_COLUMNS, withActorNames(withClinic, names));
      return sendCsv(reply, 'bulamu-my-activity.csv', csv);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // Global feed across every facility (SUPER_ADMIN only). Optionally filtered
  // to one actor, so the platform console can show "everyone" or "just them".
  fastify.get('/audit-log', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
    const { actorUserId } = request.query as { actorUserId?: string };
    try {
      const entries = await prisma.auditLog.findMany({
        where: actorUserId ? { actorUserId } : {},
        orderBy: { createdAt: 'desc' },
        take: FEED_ROW_LIMIT,
      });
      const withClinic = await withClinicNames(entries);
      const names = await resolveActorNames(entries);
      return { success: true, entries: withActorNames(withClinic, names) };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // The same global feed as a CSV download of up to EXPORT_ROW_LIMIT entries -
  // "platform activity as a whole", or for one actor when actorUserId is set.
  fastify.get('/audit-log/export', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
    const { actorUserId } = request.query as { actorUserId?: string };
    try {
      const entries = await prisma.auditLog.findMany({
        where: actorUserId ? { actorUserId } : {},
        orderBy: { createdAt: 'desc' },
        take: EXPORT_ROW_LIMIT,
      });
      const withClinic = await withClinicNames(entries);
      const names = await resolveActorNames(entries);
      const csv = buildCsv(AUDIT_CSV_COLUMNS, withActorNames(withClinic, names));
      const filename = actorUserId ? `bulamu-platform-activity-${actorUserId}.csv` : 'bulamu-platform-activity.csv';
      return sendCsv(reply, filename, csv);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // Who touched sensitive records, and when, within one facility (ADMIN for
  // their own facility; SUPER_ADMIN for any facility they specify). Optionally
  // filtered to one actor within that facility.
  fastify.get('/audit-log/:clinicId', { preHandler: [requireRole('ADMIN', 'SUPER_ADMIN')] }, async (request, reply) => {
    const { clinicId: requestedClinicId } = request.params as any;
    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;
    const { actorUserId } = request.query as { actorUserId?: string };

    try {
      const entries = await prisma.auditLog.findMany({
        where: { clinicId, ...(actorUserId ? { actorUserId } : {}) },
        orderBy: { createdAt: 'desc' },
        take: FEED_ROW_LIMIT,
      });
      const names = await resolveActorNames(entries);
      return { success: true, entries: withActorNames(entries, names) };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // One facility's activity as a CSV download of up to EXPORT_ROW_LIMIT
  // entries - "as a whole" for that facility, or for one actor within it.
  fastify.get('/audit-log/:clinicId/export', { preHandler: [requireRole('ADMIN', 'SUPER_ADMIN')] }, async (request, reply) => {
    const { clinicId: requestedClinicId } = request.params as any;
    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;
    const { actorUserId } = request.query as { actorUserId?: string };

    try {
      const [clinic, entries] = await Promise.all([
        prisma.clinic.findUnique({ where: { id: clinicId }, select: { name: true, facilityCode: true } }),
        prisma.auditLog.findMany({
          where: { clinicId, ...(actorUserId ? { actorUserId } : {}) },
          orderBy: { createdAt: 'desc' },
          take: EXPORT_ROW_LIMIT,
        }),
      ]);
      const clinicName = clinic ? `${clinic.name} (${clinic.facilityCode})` : '';
      const names = await resolveActorNames(entries);
      const csv = buildCsv(AUDIT_CSV_COLUMNS, withActorNames(entries, names).map((e) => ({ ...e, clinicName })));
      const filename = actorUserId ? `bulamu-facility-activity-${actorUserId}.csv` : 'bulamu-facility-activity.csv';
      return sendCsv(reply, filename, csv);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // Offline mutations where an older edit arrived after a newer one had
  // already synced - the "no distinct variables are overwritten" transparency
  // the research doc's conflict-resolution section calls for.
  fastify.get('/sync-conflicts/:clinicId', { preHandler: [requireRole('ADMIN', 'SUPER_ADMIN')] }, async (request, reply) => {
    const { clinicId: requestedClinicId } = request.params as any;
    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;

    try {
      const conflicts = await prisma.syncConflictLog.findMany({
        where: { clinicId },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });

      return { success: true, conflicts };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });
}
