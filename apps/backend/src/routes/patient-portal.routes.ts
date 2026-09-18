import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticatePatient, getPatientAuthUser } from '../middleware/patient-auth.middleware';
import { generateStorageKey, saveFile, getFileStream, deleteFile } from '../lib/storage';
import { recordAudit } from '../lib/audit';
import { notifyStaff } from '../lib/notifications';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

// The clinic that created the account is inherently trusted; any other
// clinic needs an active, unrevoked PatientAccessGrant - same rule GET
// /patient-portal/me filters by, kept in sync so revoking a grant also cuts
// off uploads/appointment requests against that clinic's record, not just
// its visibility.
async function isClinicAuthorized(patientAccountId: string, clinicId: string): Promise<boolean> {
  const account = await prisma.patientAccount.findUnique({ where: { id: patientAccountId }, select: { createdByClinicId: true } });
  if (account?.createdByClinicId === clinicId) return true;
  const grant = await prisma.patientAccessGrant.findFirst({ where: { patientAccountId, clinicId, revokedAt: null } });
  return !!grant;
}

// A patient's own linked Patient row - verifies recordId actually belongs to
// this account and that the owning clinic is currently authorized, before
// any read/write against it.
async function findOwnRecord(patientAccountId: string, recordId: string) {
  const record = await prisma.patient.findFirst({
    where: { id: recordId, patientAccountId, deletedAt: null },
    select: { id: true, clinicId: true, name: true },
  });
  if (!record) return null;
  return (await isClinicAuthorized(patientAccountId, record.clinicId)) ? record : null;
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
        select: { portableId: true, email: true, phone: true, createdAt: true, createdByClinicId: true },
      });
      if (!account) return reply.status(404).send({ error: 'Account not found' });

      // The facility that created the account is inherently trusted (that's
      // the foundational relationship the account exists because of) - any
      // other facility's records only surface here while it holds an active
      // PatientAccessGrant, so a revoked grant removes that facility from the
      // patient's own view too, not just from staff-to-staff visibility.
      const activeGrants = await prisma.patientAccessGrant.findMany({
        where: { patientAccountId: authUser.patientAccountId, revokedAt: null },
        select: { clinicId: true },
      });
      const authorizedClinicIds = new Set([account.createdByClinicId, ...activeGrants.map((g) => g.clinicId)]);

      const allRecords = await prisma.patient.findMany({
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

      const records = allRecords.filter((r) => authorizedClinicIds.has(r.clinic.id));

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

      await notifyStaff({
        type: 'APPOINTMENT_REQUESTED',
        clinicId: record.clinicId,
        title: 'New appointment request',
        body: `${record.name} requested an appointment on ${new Date(preferredDate).toLocaleDateString()}${preferredTime ? ` at ${preferredTime}` : ''}.`,
        link: '/appointments',
        emailSummary: 'A patient has requested an appointment through the Patient Portal. Open Appointments to review it.',
        log: (message) => fastify.log.warn(message),
      });

      return { success: true, appointmentRequest };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });

  // "Who has access to my records" - every facility that currently has (or
  // once had) a grant, including the originating one implicitly, so the
  // patient can see the full picture of who has been able to see their data.
  fastify.get('/patient-portal/access', { preHandler: [authenticatePatient] }, async (request, reply) => {
    const authUser = getPatientAuthUser(request);

    const account = await prisma.patientAccount.findUnique({
      where: { id: authUser.patientAccountId },
      select: { createdByClinicId: true, createdByClinic: { select: { id: true, name: true } }, createdAt: true },
    });
    if (!account) return reply.status(404).send({ error: 'Account not found' });

    const grants = await prisma.patientAccessGrant.findMany({
      where: { patientAccountId: authUser.patientAccountId },
      include: { clinic: { select: { id: true, name: true } } },
      orderBy: { grantedAt: 'desc' },
    });

    return {
      success: true,
      origin: { clinic: account.createdByClinic, grantedAt: account.createdAt },
      grants,
    };
  });

  // Revoking removes that facility from every future GET /patient-portal/me
  // response too (see isClinicAuthorized) - the origin facility that created
  // the account can't be revoked here since it has no grant row to revoke;
  // that relationship is the account's foundation, not a delegated one.
  fastify.delete('/patient-portal/access/:grantId', { preHandler: [authenticatePatient] }, async (request, reply) => {
    const authUser = getPatientAuthUser(request);
    const { grantId } = request.params as any;

    const grant = await prisma.patientAccessGrant.findFirst({
      where: { id: grantId, patientAccountId: authUser.patientAccountId },
    });
    if (!grant) return reply.status(404).send({ error: 'Access grant not found' });
    if (grant.revokedAt) return reply.status(409).send({ error: 'This access was already revoked' });

    const updated = await prisma.patientAccessGrant.update({
      where: { id: grantId },
      data: { revokedAt: new Date(), revokedByUserId: authUser.patientAccountId },
    });

    await recordAudit({
      entity: 'PatientAccessGrant', recordId: grant.id, clinicId: grant.clinicId,
      action: 'UPDATE', actorUserId: authUser.patientAccountId, actorRole: 'PATIENT',
      metadata: { status: 'REVOKED' },
    });

    return { success: true, grant: updated };
  });
}
