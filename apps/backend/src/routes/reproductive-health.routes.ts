import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate, assertClinicMatch, getAuthUser } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { recordAudit } from '../lib/audit';

export async function reproductiveHealthRoutes(fastify: FastifyInstance) {
  // Record a reproductive-health observation (clinician-entered, not patient self-service)
  fastify.post(
    '/patients/:patientId/reproductive-health',
    { preHandler: [requireRole('NURSE', 'DOCTOR', 'ADMIN')] },
    async (request, reply) => {
      const { patientId } = request.params as any;
      const {
        lastMenstrualPeriodDate,
        cycleLengthDays,
        flowDurationDays,
        familyPlanningMethod,
        pregnancyStatus,
        gravida,
        para,
        notes,
      } = request.body as any;

      try {
        const patient = await prisma.patient.findUnique({ where: { id: patientId } });
        if (!patient) {
          return reply.status(404).send({ error: 'Patient not found' });
        }
        if (!assertClinicMatch(request, reply, patient.clinicId)) return;

        const authUser = getAuthUser(request);

        const record = await prisma.reproductiveHealthRecord.create({
          data: {
            patientId,
            recordedById: authUser.userId,
            lastMenstrualPeriodDate: lastMenstrualPeriodDate ? new Date(lastMenstrualPeriodDate) : null,
            cycleLengthDays: cycleLengthDays != null ? Number(cycleLengthDays) : null,
            flowDurationDays: flowDurationDays != null ? Number(flowDurationDays) : null,
            familyPlanningMethod: familyPlanningMethod || 'NONE',
            pregnancyStatus: pregnancyStatus || 'UNKNOWN',
            gravida: gravida != null ? Number(gravida) : null,
            para: para != null ? Number(para) : null,
            notes: notes || null,
          },
        });

        await recordAudit({
          entity: 'ReproductiveHealthRecord', recordId: record.id, clinicId: patient.clinicId,
          action: 'CREATE', actorUserId: authUser.userId, actorRole: authUser.role,
        });

        return { success: true, record };
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
    }
  );

  // History timeline for a patient
  fastify.get(
    '/patients/:patientId/reproductive-health',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { patientId } = request.params as any;

      try {
        const patient = await prisma.patient.findUnique({ where: { id: patientId } });
        if (!patient) {
          return reply.status(404).send({ error: 'Patient not found' });
        }
        if (!assertClinicMatch(request, reply, patient.clinicId)) return;

        const records = await prisma.reproductiveHealthRecord.findMany({
          where: { patientId, deletedAt: null },
          include: { recordedBy: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
        });

        return { success: true, records };
      } catch (error: any) {
        return reply.status(500).send({ error: error.message });
      }
    }
  );

  fastify.delete(
    '/patients/:patientId/reproductive-health/:recordId',
    { preHandler: [requireRole('NURSE', 'DOCTOR', 'ADMIN')] },
    async (request, reply) => {
      const { patientId, recordId } = request.params as any;

      try {
        const patient = await prisma.patient.findUnique({ where: { id: patientId } });
        if (!patient) {
          return reply.status(404).send({ error: 'Patient not found' });
        }
        if (!assertClinicMatch(request, reply, patient.clinicId)) return;

        const existing = await prisma.reproductiveHealthRecord.findUnique({ where: { id: recordId } });
        if (!existing || existing.patientId !== patientId || existing.deletedAt) {
          return reply.status(404).send({ error: 'Record not found' });
        }

        const record = await prisma.reproductiveHealthRecord.update({ where: { id: recordId }, data: { deletedAt: new Date() } });

        const authUser = getAuthUser(request);
        await recordAudit({
          entity: 'ReproductiveHealthRecord', recordId: record.id, clinicId: patient.clinicId,
          action: 'DELETE', actorUserId: authUser.userId, actorRole: authUser.role,
        });

        return { success: true, record };
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
    }
  );
}
