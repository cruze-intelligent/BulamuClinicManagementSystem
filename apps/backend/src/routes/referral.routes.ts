import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { getAuthUser, resolveClinicScope } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { notifyStaff } from '../lib/notifications';

export async function referralRoutes(fastify: FastifyInstance) {
  // Refer a patient to another facility (e.g. HC II -> HC III for a complicated case)
  fastify.post(
    '/referrals',
    { preHandler: [requireRole('NURSE', 'DOCTOR', 'ADMIN')] },
    async (request, reply) => {
      const { patientId, toClinicId, reason } = request.body as any;
      const authUser = getAuthUser(request);

      try {
        const patient = await prisma.patient.findUnique({ where: { id: patientId } });
        if (!patient) {
          return reply.status(404).send({ error: 'Patient not found' });
        }
        if (patient.clinicId !== authUser.clinicId && authUser.role !== 'SUPER_ADMIN') {
          return reply.status(403).send({ error: 'Access denied: you do not have access to this patient' });
        }

        const toClinic = await prisma.clinic.findUnique({ where: { id: toClinicId } });
        if (!toClinic) {
          return reply.status(404).send({ error: 'Destination facility not found' });
        }

        const referral = await prisma.referral.create({
          data: {
            patientId,
            fromClinicId: patient.clinicId,
            toClinicId,
            reason,
          },
        });

        const fromClinic = await prisma.clinic.findUnique({ where: { id: patient.clinicId }, select: { name: true } });
        await notifyStaff({
          type: 'REFERRAL_RECEIVED',
          clinicId: toClinicId,
          title: 'New referral received',
          body: `${fromClinic?.name ?? 'Another facility'} referred ${patient.name} to your facility.`,
          link: '/referrals',
          emailSummary: 'Another facility has referred a patient to yours. Open Referrals to review it.',
          log: (message) => fastify.log.warn(message),
        });

        return { success: true, referral };
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
    }
  );

  // List referrals either sent from or received by a facility
  fastify.get(
    '/referrals/:clinicId',
    { preHandler: [requireRole('NURSE', 'DOCTOR', 'ADMIN')] },
    async (request, reply) => {
      const { clinicId: requestedClinicId } = request.params as any;
      const clinicId = resolveClinicScope(request, reply, requestedClinicId);
      if (!clinicId) return;

      try {
        const referrals = await prisma.referral.findMany({
          where: { OR: [{ fromClinicId: clinicId }, { toClinicId: clinicId }] },
          include: {
            patient: { select: { name: true, phone: true } },
            fromClinic: { select: { name: true } },
            toClinic: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
        });

        return { success: true, referrals };
      } catch (error: any) {
        return reply.status(500).send({ error: error.message });
      }
    }
  );

  // Update referral status - either side of the referral (sender or receiver) may act on it
  fastify.patch(
    '/referrals/:id/status',
    { preHandler: [requireRole('NURSE', 'DOCTOR', 'ADMIN')] },
    async (request, reply) => {
      const { id } = request.params as any;
      const { status } = request.body as any;
      const authUser = getAuthUser(request);

      try {
        const existing = await prisma.referral.findUnique({ where: { id } });
        if (!existing) {
          return reply.status(404).send({ error: 'Referral not found' });
        }

        const isParty = existing.fromClinicId === authUser.clinicId || existing.toClinicId === authUser.clinicId;
        if (!isParty && authUser.role !== 'SUPER_ADMIN') {
          return reply.status(403).send({ error: 'Access denied: you do not have access to this referral' });
        }

        const referral = await prisma.referral.update({ where: { id }, data: { status } });
        return { success: true, referral };
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
    }
  );
}
