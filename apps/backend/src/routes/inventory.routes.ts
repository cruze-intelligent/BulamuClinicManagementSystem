import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth.middleware';

export async function inventoryRoutes(fastify: FastifyInstance) {
  
  // Get all medicines
  fastify.get('/inventory/:clinicId', { preHandler: [authenticate] }, async (request, reply) => {
    const { clinicId } = request.params as any;

    try {
      const medicines = await prisma.medicine.findMany({
        where: { clinicId },
        orderBy: { name: 'asc' }
      });

      return { success: true, medicines };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // Add medicine
  fastify.post('/inventory', { preHandler: [authenticate] }, async (request, reply) => {
    const { clinicId, name, quantity, unit, reorderLevel, price, expiryDate } = request.body as any;

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
      const medicine = await prisma.medicine.update({
        where: { id },
        data: { quantity }
      });

      return { success: true, medicine };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });
}