import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth.middleware';

export async function labRoutes(fastify: FastifyInstance) {
  
  // Get lab tests for patient
  fastify.get('/lab/patient/:patientId', { preHandler: [authenticate] }, async (request, reply) => {
    const { patientId } = request.params as any;

    try {
      const tests = await prisma.labTest.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' }
      });

      return { success: true, tests };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // Order lab test
  fastify.post('/lab', { preHandler: [authenticate] }, async (request, reply) => {
    const { patientId, consultationId, testName, orderedBy } = request.body as any;

    try {
      const test = await prisma.labTest.create({
        data: { patientId, consultationId, testName, orderedBy, results: '' }
      });

      return { success: true, test };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });

  // Update lab results
  fastify.patch('/lab/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as any;
    const { results, status } = request.body as any;

    try {
      const test = await prisma.labTest.update({
        where: { id },
        data: { 
          results, 
          status,
          ...(status === 'COMPLETED' && { completedAt: new Date() })
        }
      });

      return { success: true, test };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });
}