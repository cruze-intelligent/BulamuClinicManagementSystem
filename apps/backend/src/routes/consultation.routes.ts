import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate, assertClinicMatch } from '../middleware/auth.middleware';
import { isValidServiceTag } from '../lib/hmis';
import { notifyNewPrescription } from '../lib/notifications';
import { normalizeDiagnoses, normalizePrescriptions, primaryDiagnosisText } from '../lib/clinical';
import { buildPrescriptionPdf, consultationChildren, linkStockItems } from '../lib/consultation-records';

const MAX_SYMPTOMS = 2000;
const MAX_CLINICAL_NOTES = 4000;

export async function consultationRoutes(fastify: FastifyInstance) {

  // Record a consultation: symptoms, one or more diagnoses (each optionally
  // ICD-10 coded, primary/secondary, confirmed/provisional), clinical notes and
  // structured prescriptions. A plain `diagnosis` string is still accepted (older
  // clients) and becomes a single uncoded primary diagnosis.
  fastify.post('/consultations', { preHandler: [authenticate] }, async (request, reply) => {
    const { appointmentId, patientId, diagnosis, diagnoses, symptoms, clinicalNotes, prescriptions, amount, serviceTags } = request.body as any;

    if (serviceTags && (!Array.isArray(serviceTags) || !serviceTags.every(isValidServiceTag))) {
      return reply.status(400).send({ error: 'Invalid serviceTags' });
    }

    const symptomsText = typeof symptoms === 'string' ? symptoms.trim() : '';
    if (!symptomsText) return reply.status(400).send({ error: 'Symptoms / presenting complaints are required' });
    if (symptomsText.length > MAX_SYMPTOMS) return reply.status(400).send({ error: `Symptoms are too long (${MAX_SYMPTOMS} characters max)` });
    const notesText = typeof clinicalNotes === 'string' ? clinicalNotes.trim() : '';
    if (notesText.length > MAX_CLINICAL_NOTES) return reply.status(400).send({ error: `Clinical notes are too long (${MAX_CLINICAL_NOTES} characters max)` });

    const validDiagnoses = normalizeDiagnoses(diagnoses, diagnosis);
    if (!validDiagnoses.ok) return reply.status(400).send({ error: validDiagnoses.error });
    const validPrescriptions = normalizePrescriptions(prescriptions);
    if (!validPrescriptions.ok) return reply.status(400).send({ error: validPrescriptions.error });

    try {
      const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
      if (!appointment) {
        return reply.status(404).send({ error: 'Appointment not found' });
      }
      if (!assertClinicMatch(request, reply, appointment.clinicId)) return;
      if (patientId !== appointment.patientId) {
        return reply.status(400).send({ error: 'patientId does not match the appointment' });
      }

      const rx = await linkStockItems(appointment.clinicId, validPrescriptions.value);

      const consultation = await prisma.consultation.create({
        data: {
          appointmentId,
          patientId,
          diagnosis: primaryDiagnosisText(validDiagnoses.value),
          symptoms: symptomsText,
          clinicalNotes: notesText || null,
          serviceTags: serviceTags || [],
          diagnoses: { create: validDiagnoses.value },
          prescriptions: { create: rx },
          invoice: amount ? {
            create: {
              clinicId: (request.user as any).clinicId,
              amount
            }
          } : undefined
        },
        include: {
          ...consultationChildren,
          invoice: true
        }
      });

      const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { name: true } });
      await notifyNewPrescription({
        clinicId: appointment.clinicId,
        patientName: patient?.name ?? 'a patient',
        itemCount: consultation.prescriptions.length,
      }, (message) => fastify.log.warn(message));

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
          ...consultationChildren,
          invoice: true,
          appointment: { include: { doctor: { select: { name: true } } } }
        },
        orderBy: { createdAt: 'desc' }
      });

      return { success: true, consultations };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // The printable prescription for a consultation: patient, diagnoses and each
  // item with its directions in plain words, ready to hand to a pharmacy.
  fastify.get('/consultations/:id/prescription/pdf', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as any;
    try {
      const existing = await prisma.consultation.findFirst({
        where: { id, deletedAt: null },
        select: { appointment: { select: { clinicId: true } }, _count: { select: { prescriptions: true } } },
      });
      if (!existing) return reply.status(404).send({ error: 'Consultation not found' });
      if (!assertClinicMatch(request, reply, existing.appointment.clinicId)) return;
      if (existing._count.prescriptions === 0) {
        return reply.status(400).send({ error: 'This consultation has no prescriptions to print' });
      }

      const built = await buildPrescriptionPdf(id);
      if (!built) return reply.status(404).send({ error: 'Consultation not found' });

      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `inline; filename="prescription-${id}.pdf"`);
      return reply.send(built.pdf);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });
}
