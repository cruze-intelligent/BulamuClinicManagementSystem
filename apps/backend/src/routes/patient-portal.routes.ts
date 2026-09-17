import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticatePatient, getPatientAuthUser } from '../middleware/patient-auth.middleware';
import { generateStorageKey, saveFile, getFileStream, deleteFile } from '../lib/storage';
import { recordAudit } from '../lib/audit';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

// A patient's own linked Patient row - verifies recordId actually belongs to
// this account before any read/write against it, the same way staff routes
// verify patient.clinicId === authUser.clinicId before touching a record.
async function findOwnRecord(patientAccountId: string, recordId: string) {
  return prisma.patient.findFirst({
    where: { id: recordId, patientAccountId, deletedAt: null },
    select: { id: true, clinicId: true },
  });
}

export async function patientPortalRoutes(fastify: FastifyInstance) {
  // The one deliberate, narrowly-scoped exception to "a facility never sees
  // another facility's data for a patient": this aggregates every Patient
  // row linked to the caller's own PatientAccount, across clinics, but only
  // inside the patient's own authenticated session (authenticatePatient) -
  // never exposed to any staff-facing route.
  fastify.get('/patient-portal/me', { preHandler: [authenticatePatient] }, async (request, reply) => {
    const authUser = getPatientAuthUser(request);

    try {
      const account = await prisma.patientAccount.findUnique({
        where: { id: authUser.patientAccountId },
        select: { portableId: true, email: true, phone: true, createdAt: true },
      });
      if (!account) return reply.status(404).send({ error: 'Account not found' });

      const records = await prisma.patient.findMany({
        where: { patientAccountId: authUser.patientAccountId, deletedAt: null },
        select: {
          id: true,
          name: true,
          sex: true,
          dateOfBirth: true,
          clinic: { select: { id: true, name: true, facilityType: true } },
          appointments: {
            where: { deletedAt: null },
            orderBy: { date: 'desc' },
            select: { id: true, date: true, time: true, status: true, notes: true, doctor: { select: { name: true } } },
          },
          consultations: {
            orderBy: { createdAt: 'desc' },
            select: {
              id: true, diagnosis: true, symptoms: true, createdAt: true,
              prescriptions: { select: { id: true, medication: true, dosage: true, frequency: true, duration: true } },
              invoice: { select: { id: true, amount: true, status: true, createdAt: true } },
            },
          },
          labTests: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { id: true, testName: true, results: true, status: true, createdAt: true },
          },
          appointmentRequests: {
            orderBy: { createdAt: 'desc' },
            select: { id: true, preferredDate: true, preferredTime: true, reason: true, status: true, declineReason: true, createdAt: true },
          },
          documents: {
            orderBy: { createdAt: 'desc' },
            select: { id: true, category: true, fileName: true, mimeType: true, fileSize: true, createdAt: true, uploadedByPatientAccountId: true },
          },
        },
      });

      return { success: true, account, records };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // Patient-initiated document upload, attached to one of the patient's own
  // linked Patient rows (recordId). Mirrors document.routes.ts's staff
  // upload, with uploadedByPatientAccountId set instead of uploadedByUserId.
  fastify.post('/patient-portal/documents', { preHandler: [authenticatePatient] }, async (request, reply) => {
    const authUser = getPatientAuthUser(request);

    const data = await request.file({ limits: { fileSize: MAX_FILE_SIZE_BYTES } });
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });

    const recordId = (data.fields?.recordId as any)?.value;
    if (!recordId) return reply.status(400).send({ error: 'recordId is required' });

    const record = await findOwnRecord(authUser.patientAccountId, recordId);
    if (!record) return reply.status(404).send({ error: 'Record not found' });

    let buffer: Buffer;
    try {
      buffer = await data.toBuffer();
    } catch {
      return reply.status(413).send({ error: 'File too large (10MB max)' });
    }

    const storageKey = generateStorageKey(data.filename);
    await saveFile(storageKey, buffer);

    const document = await prisma.document.create({
      data: {
        clinicId: record.clinicId,
        patientId: record.id,
        category: 'PATIENT_UPLOAD',
        fileName: data.filename,
        mimeType: data.mimetype,
        fileSize: buffer.length,
        storageKey,
        uploadedByPatientAccountId: authUser.patientAccountId,
      },
    });

    await recordAudit({
      entity: 'Document', recordId: document.id, clinicId: document.clinicId,
      action: 'CREATE', actorUserId: authUser.patientAccountId, actorRole: 'PATIENT',
      metadata: { patientId: record.id, fileName: document.fileName },
    });

    return { success: true, document };
  });

  // Download any document attached to one of the patient's own linked
  // records - staff-uploaded (lab results etc.) or patient-uploaded alike.
  fastify.get('/patient-portal/documents/:id/download', { preHandler: [authenticatePatient] }, async (request, reply) => {
    const authUser = getPatientAuthUser(request);
    const { id } = request.params as any;

    const document = await prisma.document.findUnique({ where: { id } });
    if (!document || !document.patientId) return reply.status(404).send({ error: 'Document not found' });

    const record = await findOwnRecord(authUser.patientAccountId, document.patientId);
    if (!record) return reply.status(404).send({ error: 'Document not found' });

    reply.header('Content-Type', document.mimeType);
    reply.header('Content-Disposition', `attachment; filename="${document.fileName}"`);
    return reply.send(getFileStream(document.storageKey));
  });

  // Delete a document - only one the patient themselves uploaded; documents
  // staff attached to a clinical record (lab results etc.) stay staff-managed.
  fastify.delete('/patient-portal/documents/:id', { preHandler: [authenticatePatient] }, async (request, reply) => {
    const authUser = getPatientAuthUser(request);
    const { id } = request.params as any;

    const document = await prisma.document.findUnique({ where: { id } });
    if (!document) return reply.status(404).send({ error: 'Document not found' });
    if (document.uploadedByPatientAccountId !== authUser.patientAccountId) {
      return reply.status(403).send({ error: 'Access denied' });
    }

    await deleteFile(document.storageKey);
    await prisma.document.delete({ where: { id } });

    await recordAudit({
      entity: 'Document', recordId: document.id, clinicId: document.clinicId,
      action: 'DELETE', actorUserId: authUser.patientAccountId, actorRole: 'PATIENT',
      metadata: { fileName: document.fileName },
    });

    return { success: true };
  });

  // Request an appointment at a clinic where the patient already has a
  // linked record. Staff at that clinic confirm (assigning a doctor/date,
  // creating the real Appointment) or decline it - patients never create an
  // Appointment directly, keeping scheduling authority with the facility.
  fastify.post('/patient-portal/appointments/request', { preHandler: [authenticatePatient] }, async (request, reply) => {
    const authUser = getPatientAuthUser(request);
    const { recordId, preferredDate, preferredTime, reason } = request.body as any;

    if (!recordId || !preferredDate) {
      return reply.status(400).send({ error: 'recordId and preferredDate are required' });
    }

    const record = await findOwnRecord(authUser.patientAccountId, recordId);
    if (!record) return reply.status(404).send({ error: 'Record not found' });

    try {
      const appointmentRequest = await prisma.appointmentRequest.create({
        data: {
          patientAccountId: authUser.patientAccountId,
          patientId: record.id,
          clinicId: record.clinicId,
          preferredDate: new Date(preferredDate),
          preferredTime: preferredTime || null,
          reason: reason || null,
        },
      });

      return { success: true, appointmentRequest };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });
}
