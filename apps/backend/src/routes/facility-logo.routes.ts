import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate, getAuthUser, resolveClinicScope } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { recordAudit } from '../lib/audit';
import { MAX_LOGO_BYTES, parseLogo } from '../lib/facility-logo';

const MAX_MOTTO_LENGTH = 80;

// A facility's logo and motto, shown on its own documents. The facility's
// administrator manages them; anyone signed in at the facility can see them.
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
    // Room for an image well over the limit, so an oversized one gets the clear
    // 'must be smaller than 500 KB' answer below rather than a bare refusal.
    { preHandler: [requireRole('ADMIN')], bodyLimit: MAX_LOGO_BYTES * 4 },
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

  // The facility's motto, printed under its name at the top of its documents.
  // Like the logo it is the facility's own branding, so it is not one of the
  // details whose changes Bulamu reviews (see facility-details.ts). Empty clears it.
  fastify.put('/clinics/:clinicId/motto', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const clinicId = resolveClinicScope(request, reply, (request.params as { clinicId: string }).clinicId);
    if (!clinicId) return;
    const raw = (request.body as { motto?: unknown } | undefined)?.motto;
    if (raw !== null && raw !== undefined && typeof raw !== 'string') return reply.status(400).send({ error: 'The motto must be text' });
    const motto = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
    if (motto.length > MAX_MOTTO_LENGTH) return reply.status(400).send({ error: `Keep the motto to ${MAX_MOTTO_LENGTH} characters, so it fits under the name` });

    await prisma.clinic.update({ where: { id: clinicId }, data: { motto: motto || null } });
    const authUser = getAuthUser(request);
    await recordAudit({
      entity: 'Clinic', recordId: clinicId, clinicId,
      action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role,
      metadata: { fields: ['motto'], ...(motto ? {} : { removed: true }) },
    });
    return { success: true, motto: motto || null };
  });

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
