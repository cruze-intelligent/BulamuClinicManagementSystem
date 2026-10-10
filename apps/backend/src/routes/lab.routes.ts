import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate, assertClinicMatch, getAuthUser } from '../middleware/auth.middleware';
import { notifyLabOrdered, notifyLabResultReady, notifyLabResultToOrderer } from '../lib/notifications';

export async function labRoutes(fastify: FastifyInstance) {

  // Get lab tests for patient
  fastify.get('/lab/patient/:patientId', { preHandler: [authenticate] }, async (request, reply) => {
    const { patientId } = request.params as any;

    try {
      const patient = await prisma.patient.findUnique({ where: { id: patientId } });
      if (!patient) {
        return reply.status(404).send({ error: 'Patient not found' });
      }
      if (!assertClinicMatch(request, reply, patient.clinicId)) return;

      const tests = await prisma.labTest.findMany({
        where: { patientId, deletedAt: null },
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
      const patient = await prisma.patient.findUnique({ where: { id: patientId } });
      if (!patient) {
        return reply.status(404).send({ error: 'Patient not found' });
      }
      if (!assertClinicMatch(request, reply, patient.clinicId)) return;

      const authUser = getAuthUser(request);
      const test = await prisma.labTest.create({
        data: { patientId, consultationId, testName, orderedBy, orderedByUserId: authUser.userId, results: '' }
      });

      await notifyLabOrdered(
        { clinicId: patient.clinicId, patientName: patient.name, testName: test.testName, orderedByUserId: authUser.userId },
        (message) => fastify.log.warn(message)
      );

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
      const existing = await prisma.labTest.findUnique({ where: { id }, include: { patient: true } });
      if (!existing) {
        return reply.status(404).send({ error: 'Lab test not found' });
      }
      if (!assertClinicMatch(request, reply, existing.patient.clinicId)) return;

      const test = await prisma.labTest.update({
        where: { id },
        data: {
          results,
          status,
          ...(status === 'COMPLETED' && { completedAt: new Date() })
        }
      });

      // Tell the patient and the clinician who ordered it - once, when the
      // result first becomes available.
      if (status === 'COMPLETED' && existing.status !== 'COMPLETED') {
        const log = (message: string) => fastify.log.warn(message);
        await notifyLabResultReady({ patient: existing.patient, testName: test.testName }, log);
        await notifyLabResultToOrderer({
          clinicId: existing.patient.clinicId, patientName: existing.patient.name, testName: test.testName,
          orderedByUserId: existing.orderedByUserId, recordedByUserId: getAuthUser(request).userId,
        }, log);
      }

      return { success: true, test };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });
}