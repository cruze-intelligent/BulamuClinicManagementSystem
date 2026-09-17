import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate, assertClinicMatch } from '../middleware/auth.middleware';
import { isValidServiceTag } from '../lib/hmis';

export async function consultationRoutes(fastify: FastifyInstance) {

  // Create consultation with prescriptions
  fastify.post('/consultations', { preHandler: [authenticate] }, async (request, reply) => {
    const { appointmentId, patientId, diagnosis, symptoms, prescriptions, amount, serviceTags } = request.body as any;

    if (serviceTags && (!Array.isArray(serviceTags) || !serviceTags.every(isValidServiceTag))) {
      return reply.status(400).send({ error: 'Invalid serviceTags' });
    }

    try {
      const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
      if (!appointment) {
        return reply.status(404).send({ error: 'Appointment not found' });
      }
      if (!assertClinicMatch(request, reply, appointment.clinicId)) return;
      if (patientId !== appointment.patientId) {
        return reply.status(400).send({ error: 'patientId does not match the appointment' });
      }

      const consultation = await prisma.consultation.create({
        data: {
          appointmentId,
          patientId,
          diagnosis,
          symptoms,
          serviceTags: serviceTags || [],
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
      const patient = await prisma.patient.findUnique({ where: { id: patientId } });
      if (!patient) {
        return reply.status(404).send({ error: 'Patient not found' });
      }
      if (!assertClinicMatch(request, reply, patient.clinicId)) return;

      const consultations = await prisma.consultation.findMany({
        where: { patientId, deletedAt: null },
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