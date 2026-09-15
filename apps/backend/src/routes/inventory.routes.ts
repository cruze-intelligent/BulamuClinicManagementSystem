import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate, resolveClinicScope, assertClinicMatch } from '../middleware/auth.middleware';

export async function inventoryRoutes(fastify: FastifyInstance) {

  // Get all medicines
  fastify.get('/inventory/:clinicId', { preHandler: [authenticate] }, async (request, reply) => {
    const { clinicId: requestedClinicId } = request.params as any;
    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;

    try {
      const medicines = await prisma.medicine.findMany({
        where: { clinicId, deletedAt: null },
        orderBy: { name: 'asc' }
      });

      return { success: true, medicines };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // Add medicine
  fastify.post('/inventory', { preHandler: [authenticate] }, async (request, reply) => {
    const { clinicId: requestedClinicId, name, quantity, unit, reorderLevel, price, expiryDate } = request.body as any;
    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;

    try {
      const medicine = await prisma.medicine.create({
        data: { clinicId, name, quantity, unit, reorderLevel, price, expiryDate: expiryDate ? new Date(expiryDate) : null }
      });

      return { success: true, medicine };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });

  // Update quantity
  fastify.patch('/inventory/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as any;
    const { quantity } = request.body as any;

    try {
      const existing = await prisma.medicine.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ error: 'Medicine not found' });
      }
      if (!assertClinicMatch(request, reply, existing.clinicId)) return;

      const medicine = await prisma.medicine.update({
        where: { id },
        data: { quantity }
      });

      return { success: true, medicine };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });

  // Remove a discontinued/expired medicine from the active list (soft delete)
  fastify.delete('/inventory/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as any;

    try {
      const existing = await prisma.medicine.findUnique({ where: { id } });
      if (!existing || existing.deletedAt) {
        return reply.status(404).send({ error: 'Medicine not found' });
      }
      if (!assertClinicMatch(request, reply, existing.clinicId)) return;

      const medicine = await prisma.medicine.update({ where: { id }, data: { deletedAt: new Date() } });
      return { success: true, medicine };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });
}