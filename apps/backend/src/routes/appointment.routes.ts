import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate, resolveClinicScope, assertClinicMatch } from '../middleware/auth.middleware';

export async function appointmentRoutes(fastify: FastifyInstance) {

  // Create appointment
  fastify.post('/appointments', { preHandler: [authenticate] }, async (request, reply) => {
    const { patientId, doctorId, clinicId: requestedClinicId, date, time, notes } = request.body as any;
    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;

    try {
      const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { clinicId: true } });
      if (!patient || patient.clinicId !== clinicId) {
        return reply.status(404).send({ error: 'Patient not found' });
      }
      if (doctorId) {
        const doctor = await prisma.user.findUnique({ where: { id: doctorId }, select: { clinicId: true } });
        if (!doctor || doctor.clinicId !== clinicId) {
          return reply.status(404).send({ error: 'Doctor not found' });
        }
      }

      const appointment = await prisma.appointment.create({
        data: { patientId, doctorId, clinicId, date: new Date(date), time, notes },
        include: { patient: true, doctor: { select: { id: true, name: true } } }
      });

      return { success: true, appointment };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });

  // Get appointments for clinic (by date)
  fastify.get('/appointments/:clinicId', { preHandler: [authenticate] }, async (request, reply) => {
    const { clinicId: requestedClinicId } = request.params as any;
    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;
    const { date } = request.query as any;

    try {
      const appointments = await prisma.appointment.findMany({
        where: {
          clinicId,
          deletedAt: null,
          ...(date && { date: new Date(date) })
        },
        include: {
          patient: true, 
          doctor: { select: { id: true, name: true } } 
        },
        orderBy: { time: 'asc' }
      });

      return { success: true, appointments, count: appointments.length };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // Update appointment status
  fastify.patch('/appointments/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as any;
    const { status } = request.body as any;

    try {
      const existing = await prisma.appointment.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ error: 'Appointment not found' });
      }
      if (!assertClinicMatch(request, reply, existing.clinicId)) return;

      const appointment = await prisma.appointment.update({
        where: { id },
        data: { status }
      });

      return { success: true, appointment };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });
}