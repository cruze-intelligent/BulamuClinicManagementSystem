import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate, resolveClinicScope, getAuthUser } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';

export async function auditRoutes(fastify: FastifyInstance) {
  // Every role's own activity, scoped to their own actions in their own
  // facility - never another user's, and never another facility's.
  fastify.get('/audit-log/me', { preHandler: [authenticate] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    try {
      const entries = await prisma.auditLog.findMany({
        where: { clinicId: authUser.clinicId, actorUserId: authUser.userId },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return { success: true, entries };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // Global feed across every facility (SUPER_ADMIN only).
  fastify.get('/audit-log', { preHandler: [requireRole('SUPER_ADMIN')] }, async (_request, reply) => {
    try {
      const entries = await prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      const clinics = await prisma.clinic.findMany({
        where: { id: { in: [...new Set(entries.map((e) => e.clinicId))] } },
        select: { id: true, name: true, facilityCode: true },
      });
      const clinicById = new Map(clinics.map((c) => [c.id, c]));
      return {
        success: true,
        entries: entries.map((e) => ({ ...e, clinicName: clinicById.get(e.clinicId)?.name || 'Unknown facility' })),
      };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // Who touched sensitive records, and when, within one facility (ADMIN for
  // their own facility; SUPER_ADMIN for any facility they specify).
  fastify.get('/audit-log/:clinicId', { preHandler: [requireRole('ADMIN', 'SUPER_ADMIN')] }, async (request, reply) => {
    const { clinicId: requestedClinicId } = request.params as any;
    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;

    try {
      const entries = await prisma.auditLog.findMany({
        where: { clinicId },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });

      return { success: true, entries };
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
