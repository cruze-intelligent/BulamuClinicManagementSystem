import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth.middleware';

export async function consultationRoutes(fastify: FastifyInstance) {
  
  // Create consultation with prescriptions
  fastify.post('/consultations', { preHandler: [authenticate] }, async (request, reply) => {
    const { appointmentId, patientId, diagnosis, symptoms, prescriptions, amount } = request.body as any;

    try {
      const consultation = await prisma.consultation.create({
        data: {
          appointmentId,
          patientId,
          diagnosis,
          symptoms,
          prescriptions: {
            create: prescriptions
          },
          invoice: amount ? {
            create: {
              clinicId: (request.user as any).clinicId,
              amount
            }
          } : undefined
        },
        include: {
          prescriptions: true,
          invoice: true
        }
      });

      return { success: true, consultation };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });

  // Get patient consultations
  fastify.get('/consultations/patient/:patientId', { preHandler: [authenticate] }, async (request, reply) => {
    const { patientId } = request.params as any;

    try {
      const consultations = await prisma.consultation.findMany({
        where: { patientId },
        include: {
          prescriptions: true,
          invoice: true,
          appointment: true
        },
        orderBy: { createdAt: 'desc' }
      });

      return { success: true, consultations };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });
}