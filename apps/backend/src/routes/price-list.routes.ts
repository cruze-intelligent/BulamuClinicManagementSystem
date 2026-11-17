import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { getAuthUser, resolveClinicScope } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { recordAudit } from '../lib/audit';
import { BILLING_ROLES } from '../lib/invoices';
import { MAX_PRICES, parseServicePrice } from '../lib/price-list';
import { sendRouteError } from '../lib/http-error';

// The facility's price list. Everyone who bills can read it (so a charge is
// priced the same way whoever adds it); only the administrator sets prices.
export async function priceListRoutes(fastify: FastifyInstance) {
  fastify.get('/clinics/:clinicId/price-list', { preHandler: [requireRole(...BILLING_ROLES, 'SUPER_ADMIN')] }, async (request, reply) => {
    const clinicId = resolveClinicScope(request, reply, (request.params as { clinicId: string }).clinicId);
    if (!clinicId) return;
    try {
      const prices = await prisma.servicePrice.findMany({
        where: { clinicId },
        orderBy: [{ kind: 'asc' }, { name: 'asc' }],
        select: { id: true, kind: true, name: true, price: true, updatedAt: true },
      });
      return { success: true, prices };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // Set a price: { kind, name, price }, with the id to change an existing one.
  // A name already on the list for that kind of charge (in any letter case) has
  // its price changed rather than being listed twice.
  fastify.put('/clinics/:clinicId/price-list', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const clinicId = resolveClinicScope(request, reply, (request.params as { clinicId: string }).clinicId);
    if (!clinicId) return;
    const parsed = parseServicePrice(request.body);
    if ('error' in parsed) return reply.status(400).send({ error: parsed.error });
    const id = (request.body as { id?: unknown })?.id;
    try {
      const same = await prisma.servicePrice.findFirst({ where: { clinicId, kind: parsed.kind, name: { equals: parsed.name, mode: 'insensitive' } } });
      let target = same;
      if (typeof id === 'string' && id) {
        const existing = await prisma.servicePrice.findFirst({ where: { id, clinicId } });
        if (!existing) return reply.status(404).send({ error: 'That price is no longer on the list' });
        if (same && same.id !== existing.id) return reply.status(409).send({ error: `"${same.name}" is already on the list - change its price instead` });
        target = existing;
      } else if (!same && (await prisma.servicePrice.count({ where: { clinicId } })) >= MAX_PRICES) {
        return reply.status(400).send({ error: `The price list holds up to ${MAX_PRICES} items - remove ones no longer offered` });
      }
      const price = target
        ? await prisma.servicePrice.update({ where: { id: target.id }, data: { kind: parsed.kind, name: parsed.name, price: parsed.price } })
        : await prisma.servicePrice.create({ data: { clinicId, ...parsed } });
      const authUser = getAuthUser(request);
      await recordAudit({
        entity: 'ServicePrice', recordId: price.id, clinicId, action: target ? 'UPDATE' : 'CREATE',
        actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { kind: price.kind, name: price.name, price: price.price, ...(target && target.price !== price.price ? { was: target.price } : {}) },
      });
      return { success: true, price };
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
    }
  });

  fastify.delete('/clinics/:clinicId/price-list/:id', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const { clinicId: requested, id } = request.params as { clinicId: string; id: string };
    const clinicId = resolveClinicScope(request, reply, requested);
    if (!clinicId) return;
    try {
      const existing = await prisma.servicePrice.findFirst({ where: { id, clinicId } });
      if (!existing) return reply.status(404).send({ error: 'That price is no longer on the list' });
      await prisma.servicePrice.delete({ where: { id } });
      const authUser = getAuthUser(request);
      await recordAudit({
        entity: 'ServicePrice', recordId: id, clinicId, action: 'DELETE', actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { kind: existing.kind, name: existing.name, price: existing.price },
      });
      return { success: true };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });
}
