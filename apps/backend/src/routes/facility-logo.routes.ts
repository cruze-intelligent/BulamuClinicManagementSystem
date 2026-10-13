import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate, getAuthUser, resolveClinicScope } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { recordAudit } from '../lib/audit';
import { MAX_LOGO_BYTES, parseLogo } from '../lib/facility-logo';

// A facility's logo, shown on its own documents. The facility's administrator
// manages it; anyone signed in at the facility can see it.
export async function facilityLogoRoutes(fastify: FastifyInstance) {
  fastify.get('/clinics/:clinicId/logo', { preHandler: [authenticate] }, async (request, reply) => {
    const clinicId = resolveClinicScope(request, reply, (request.params as { clinicId: string }).clinicId);
    if (!clinicId) return;
    const logo = await prisma.clinicLogo.findUnique({ where: { clinicId } });
    if (!logo) return reply.status(404).send({ error: 'No logo yet' });
    reply.header('Content-Type', logo.mimeType);
    reply.header('Cache-Control', 'private, no-cache');
    return reply.send(Buffer.from(logo.data));
  });

  fastify.put(
    '/clinics/:clinicId/logo',
    // A base64 image is about a third larger than the file itself.
    { preHandler: [requireRole('ADMIN')], bodyLimit: Math.ceil(MAX_LOGO_BYTES * 1.4) + 1024 },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, reply, (request.params as { clinicId: string }).clinicId);
      if (!clinicId) return;
      const parsed = parseLogo((request.body as { image?: unknown } | undefined)?.image);
      if ('error' in parsed) return reply.status(400).send({ error: parsed.error });

      await prisma.clinicLogo.upsert({
        where: { clinicId },
        update: { data: parsed.data, mimeType: parsed.mimeType },
        create: { clinicId, data: parsed.data, mimeType: parsed.mimeType },
      });
      const authUser = getAuthUser(request);
      await recordAudit({
        entity: 'Clinic', recordId: clinicId, clinicId,
        action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { fields: ['logo'] },
      });
      return { success: true };
    }
  );

  fastify.delete('/clinics/:clinicId/logo', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const clinicId = resolveClinicScope(request, reply, (request.params as { clinicId: string }).clinicId);
    if (!clinicId) return;
    const { count } = await prisma.clinicLogo.deleteMany({ where: { clinicId } });
    if (count) {
      const authUser = getAuthUser(request);
      await recordAudit({
        entity: 'Clinic', recordId: clinicId, clinicId,
        action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { fields: ['logo'], removed: true },
      });
    }
    return { success: true };
  });
}
