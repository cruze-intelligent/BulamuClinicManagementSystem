import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate, resolveClinicScope, assertClinicMatch, getAuthUser } from '../middleware/auth.middleware';
import { recordAudit } from '../lib/audit';
import { notifyPatient } from '../lib/notifications';

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

  // List patient-initiated appointment requests for this clinic
  fastify.get('/appointment-requests/:clinicId', { preHandler: [authenticate] }, async (request, reply) => {
    const { clinicId: requestedClinicId } = request.params as any;
    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;
    const { status } = request.query as any;

    try {
      const requests = await prisma.appointmentRequest.findMany({
        where: { clinicId, ...(status && { status }) },
        include: { patient: { select: { id: true, name: true, phone: true } } },
        orderBy: { createdAt: 'desc' },
      });

      return { success: true, requests };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // Accept a request: staff assigns a doctor + confirms date/time, which
  // creates the real Appointment and links it back to the request.
  fastify.post('/appointment-requests/:id/accept', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as any;
    const { doctorId, date, time } = request.body as any;
    const authUser = getAuthUser(request);

    if (!doctorId || !date || !time) {
      return reply.status(400).send({ error: 'doctorId, date, and time are required' });
    }

    try {
      const existing = await prisma.appointmentRequest.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send({ error: 'Request not found' });
      if (!assertClinicMatch(request, reply, existing.clinicId)) return;
      if (existing.status !== 'PENDING') {
        return reply.status(409).send({ error: 'This request has already been resolved' });
      }

      const doctor = await prisma.user.findUnique({ where: { id: doctorId }, select: { clinicId: true } });
      if (!doctor || doctor.clinicId !== existing.clinicId) {
        return reply.status(404).send({ error: 'Doctor not found' });
      }

      const appointment = await prisma.appointment.create({
        data: {
          patientId: existing.patientId,
          doctorId,
          clinicId: existing.clinicId,
          date: new Date(date),
          time,
          notes: existing.reason || undefined,
        },
      });

      const appointmentRequest = await prisma.appointmentRequest.update({
        where: { id },
        data: {
          status: 'ACCEPTED',
          resultingAppointmentId: appointment.id,
          resolvedByUserId: authUser.userId,
          resolvedAt: new Date(),
        },
      });

      await recordAudit({
        entity: 'AppointmentRequest', recordId: id, clinicId: existing.clinicId,
        action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { status: 'ACCEPTED', appointmentId: appointment.id },
      });

      const clinic = await prisma.clinic.findUnique({ where: { id: existing.clinicId }, select: { name: true } });
      await notifyPatient({
        type: 'APPOINTMENT_CONFIRMED',
        patientAccountId: existing.patientAccountId,
        clinicId: existing.clinicId,
        title: 'Your appointment is confirmed',
        body: `${clinic?.name ?? 'Your facility'} confirmed your appointment on ${new Date(date).toLocaleDateString()} at ${time}.`,
        link: '/patient-portal/dashboard',
        emailSummary: 'Your appointment request has been confirmed. Sign in to your Patient Portal to see the details.',
        log: (message) => fastify.log.warn(message),
      });

      return { success: true, appointment, appointmentRequest };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });

  // Decline a request - no Appointment is created
  fastify.post('/appointment-requests/:id/decline', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as any;
    const { reason } = request.body as any;
    const authUser = getAuthUser(request);

    try {
      const existing = await prisma.appointmentRequest.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send({ error: 'Request not found' });
      if (!assertClinicMatch(request, reply, existing.clinicId)) return;
      if (existing.status !== 'PENDING') {
        return reply.status(409).send({ error: 'This request has already been resolved' });
      }

      const appointmentRequest = await prisma.appointmentRequest.update({
        where: { id },
        data: {
          status: 'DECLINED',
          declineReason: reason || null,
          resolvedByUserId: authUser.userId,
          resolvedAt: new Date(),
        },
      });

      await recordAudit({
        entity: 'AppointmentRequest', recordId: id, clinicId: existing.clinicId,
        action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { status: 'DECLINED' },
      });

      const clinic = await prisma.clinic.findUnique({ where: { id: existing.clinicId }, select: { name: true } });
      await notifyPatient({
        type: 'APPOINTMENT_DECLINED',
        patientAccountId: existing.patientAccountId,
        clinicId: existing.clinicId,
        title: 'Your appointment request could not be accepted',
        body: `${clinic?.name ?? 'Your facility'} was unable to accept your appointment request${reason ? `: ${reason}` : '.'}`,
        link: '/patient-portal/dashboard',
        emailSummary: 'The facility was unable to accept your appointment request. Sign in to your Patient Portal to see the details and request another time.',
        log: (message) => fastify.log.warn(message),
      });

      return { success: true, appointmentRequest };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });
}