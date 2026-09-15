import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { resolveClinicScope } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';

export async function auditRoutes(fastify: FastifyInstance) {
  // Who touched sensitive records, and when (ADMIN/SUPER_ADMIN only)
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
