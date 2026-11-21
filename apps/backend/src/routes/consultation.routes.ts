import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate, assertClinicMatch, getAuthUser } from '../middleware/auth.middleware';
import { isValidServiceTag } from '../lib/hmis';
import { notifyNewPrescription } from '../lib/notifications';
import { normalizeDiagnoses, normalizePrescriptions, normalizeProcedures, primaryDiagnosisText } from '../lib/clinical';
import { buildPrescriptionPdf, consultationChildren, linkStockItems } from '../lib/consultation-records';
import { parseFee } from '../lib/invoices';
import { documentProducer } from '../lib/document-signer';
import { recordAudit } from '../lib/audit';
import { sendRouteError } from '../lib/http-error';
import { parseConsultationNotes } from '../lib/consultation-notes';
import { inlineDisposition } from '../lib/document-name';

const MAX_SYMPTOMS = 2000;
const MAX_CLINICAL_NOTES = 4000;

export async function consultationRoutes(fastify: FastifyInstance) {

  // Record a consultation: symptoms, one or more diagnoses (each optionally
  // ICD-10 coded, primary/secondary, confirmed/provisional), clinical notes and
  // structured prescriptions. A plain `diagnosis` string is still accepted (older
  // clients) and becomes a single uncoded primary diagnosis.
  fastify.post('/consultations', { preHandler: [authenticate] }, async (request, reply) => {
    const { appointmentId, patientId, diagnosis, diagnoses, symptoms, clinicalNotes, prescriptions, procedures, fee: feeInput, amount, serviceTags } = request.body as any;

    if (serviceTags && (!Array.isArray(serviceTags) || !serviceTags.every(isValidServiceTag))) {
      return reply.status(400).send({ error: 'Invalid serviceTags' });
    }

    const symptomsText = typeof symptoms === 'string' ? symptoms.trim() : '';
    if (!symptomsText) return reply.status(400).send({ error: 'Symptoms / presenting complaints are required' });
    if (symptomsText.length > MAX_SYMPTOMS) return reply.status(400).send({ error: `Symptoms are too long (${MAX_SYMPTOMS} characters max)` });
    const notesText = typeof clinicalNotes === 'string' ? clinicalNotes.trim() : '';
    if (notesText.length > MAX_CLINICAL_NOTES) return reply.status(400).send({ error: `Clinical notes are too long (${MAX_CLINICAL_NOTES} characters max)` });

    const notes = parseConsultationNotes(request.body as Record<string, unknown>);
    if ('error' in notes) return reply.status(400).send({ error: notes.error });
    const validDiagnoses = normalizeDiagnoses(diagnoses, diagnosis);
    if (!validDiagnoses.ok) return reply.status(400).send({ error: validDiagnoses.error });
    const validPrescriptions = normalizePrescriptions(prescriptions);
    if (!validPrescriptions.ok) return reply.status(400).send({ error: validPrescriptions.error });
    const validProcedures = normalizeProcedures(procedures);
    if (!validProcedures.ok) return reply.status(400).send({ error: validProcedures.error });
    // `amount` is the older name for the consultation fee.
    let fee: number | null;
    try {
      fee = parseFee(feeInput ?? amount);
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
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

      const rx = await linkStockItems(appointment.clinicId, validPrescriptions.value);

      const consultation = await prisma.consultation.create({
        data: {
          appointmentId,
          patientId,
          recordedByUserId: getAuthUser(request).userId,
          diagnosis: primaryDiagnosisText(validDiagnoses.value),
          symptoms: symptomsText,
          history: notes.value.history ?? null,
          examination: notes.value.examination ?? null,
          vitals: notes.value.vitals ?? undefined,
          clinicalNotes: notesText || null,
          serviceTags: serviceTags || [],
          diagnoses: { create: validDiagnoses.value },
          prescriptions: { create: rx },
          procedures: { create: validProcedures.value },
          // The facility's invoice to the patient, filed under the facility
          // where the visit happened.
          invoice: fee ? {
            create: {
              clinicId: appointment.clinicId, patientId, amount: fee, createdByUserId: getAuthUser(request).userId,
              items: { create: { kind: 'CONSULTATION', description: 'Consultation', quantity: 1, unitPrice: fee, amount: fee, addedByUserId: getAuthUser(request).userId } },
            },
          } : undefined,
        },
        include: {
          ...consultationChildren,
          invoice: true
        }
      });

      // Seen: the patient leaves the waiting queue.
      await prisma.appointment.updateMany({ where: { id: appointmentId, status: 'SCHEDULED' }, data: { status: 'COMPLETED' } });

      const authUser = getAuthUser(request);
      await recordAudit({
        entity: 'Consultation', recordId: consultation.id, clinicId: appointment.clinicId, action: 'CREATE',
        actorUserId: authUser.userId, actorRole: authUser.role, metadata: { prescriptions: rx.length, ...(fee ? { fee } : {}) },
      });

      const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { name: true } });
      await notifyNewPrescription({
        clinicId: appointment.clinicId,
        patientName: patient?.name ?? 'a patient',
        itemCount: consultation.prescriptions.length,
      }, (message) => fastify.log.warn(message));

      return { success: true, consultation };
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
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
          appointment: { include: { doctor: { select: { name: true } } } },
          recordedBy: { select: { name: true, role: true } },
        },
        orderBy: { createdAt: 'desc' }
      });

      return { success: true, consultations };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // The printable prescription for a consultation: patient, diagnoses and each
  // item with its directions in plain words, ready to hand to a pharmacy.
  fastify.get('/consultations/:id/prescription/pdf', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as any;
    try {
      const existing = await prisma.consultation.findFirst({
        where: { id, deletedAt: null },
        select: { appointment: { select: { clinicId: true } }, _count: { select: { prescriptions: true, procedures: true } } },
      });
      if (!existing) return reply.status(404).send({ error: 'Consultation not found' });
      if (!assertClinicMatch(request, reply, existing.appointment.clinicId)) return;
      if (existing._count.prescriptions === 0 && existing._count.procedures === 0) {
        return reply.status(400).send({ error: 'This visit has no prescription or procedure to print' });
      }

      const built = await buildPrescriptionPdf(id, await documentProducer(getAuthUser(request).userId));
      if (!built) return reply.status(404).send({ error: 'Consultation not found' });

      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', inlineDisposition(built.fileName));
      return reply.send(built.pdf);
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });
}
