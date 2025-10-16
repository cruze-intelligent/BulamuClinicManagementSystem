import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth.middleware';

export async function patientRoutes(fastify: FastifyInstance) {
  
  // Create patient (protected)
  fastify.post('/patients', { preHandler: [authenticate] }, async (request, reply) => {
    const { name, phone, clinicId } = request.body as any;

    try {
      const patient = await prisma.patient.create({
        data: { name, phone, clinicId }
      });

      return { success: true, patient };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });

  // Get all patients for a clinic
  // Get all patients for a clinic (protected)
  fastify.get('/patients/:clinicId', { preHandler: [authenticate] }, async (request, reply) => {
    const { clinicId } = request.params as any;

    try {
      const patients = await prisma.patient.findMany({
        where: { clinicId },
        orderBy: { createdAt: 'desc' }
      });

      return { success: true, patients, count: patients.length };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });
}