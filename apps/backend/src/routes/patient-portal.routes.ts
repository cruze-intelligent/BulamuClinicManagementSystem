import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticatePatient, getPatientAuthUser } from '../middleware/patient-auth.middleware';
import { generateStorageKey, storedKeys } from '../lib/storage';
import { removeDocument, sendDocumentFile, storeDocument, withAvailability } from '../lib/document-files';
import { recordAudit } from '../lib/audit';
import { notifyStaff } from '../lib/notifications';
import { buildPrescriptionPdf } from '../lib/consultation-records';
import { detectDocumentFormat, normalizeFileName, withFormat, SUPPORTED_FORMATS_MESSAGE } from '../lib/document-format';
import { generateDischargeSummaryPdf, generateReferralLetterPdf } from '../lib/pdf';
import { referralLetterInput } from './referral.routes';
import { dischargeSummaryInput } from './admission.routes';
import { facilityLogo } from '../lib/facility-logo';
import { sendRouteError } from '../lib/http-error';
import { buildReceipt } from './invoice.routes';
import { CHARGE_KINDS, PAYMENT_METHODS, formatReceiptNumber } from '../lib/invoices';

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
          allergyStatus: true,
          allergies: true,
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
              diagnoses: {
                orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
                select: { id: true, icd10Code: true, description: true, type: true, certainty: true, notes: true },
              },
              prescriptions: {
                orderBy: { createdAt: 'asc' },
                select: {
                  id: true, medication: true, strength: true, form: true, dosage: true, route: true,
                  frequency: true, duration: true, quantity: true, instructions: true, dispensedAt: true,
                },
              },
              invoice: { select: { id: true, amount: true, amountPaid: true, status: true, createdAt: true } },
            },
          },
          labTests: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { id: true, testName: true, results: true, status: true, createdAt: true, verifiedAt: true },
          },
          appointmentRequests: {
            orderBy: { createdAt: 'desc' },
            select: { id: true, preferredDate: true, preferredTime: true, reason: true, status: true, declineReason: true, createdAt: true },
          },
          documents: {
            orderBy: { createdAt: 'desc' },
            select: { id: true, category: true, fileName: true, mimeType: true, fileSize: true, createdAt: true, uploadedByPatientAccountId: true, storageKey: true },
          },
          referrals: {
            orderBy: { createdAt: 'desc' },
            select: { id: true, reason: true, urgency: true, status: true, responseNote: true, createdAt: true, toClinic: { select: { name: true } } },
          },
          // Every bill, with what it was for and each payment's receipt - visits and walk-ins
          // alike. A cancelled bill was a mistake, not a record the patient needs.
          invoices: {
            where: { status: { not: 'CANCELLED' } },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true, amount: true, amountPaid: true, status: true, createdAt: true, consultationId: true,
              items: { orderBy: { createdAt: 'asc' }, select: { id: true, kind: true, description: true, quantity: true, unitPrice: true, amount: true } },
              payments: { where: { voidedAt: null }, orderBy: { receivedAt: 'asc' }, select: { id: true, receiptNumber: true, amount: true, method: true, receivedAt: true } },
            },
          },
          admissions: {
            orderBy: { admittedAt: 'desc' },
            select: {
              id: true, status: true, admittedAt: true, dischargedAt: true, reason: true, outcome: true,
              dischargeDiagnosis: true, dischargeSummary: true, followUpInstructions: true, ward: { select: { name: true } },
            },
          },
        },
      });

      const visible = allRecords.filter((r) => authorizedClinicIds.has(r.clinic.id));
      const stored = await storedKeys(visible.flatMap((r) => r.documents.map((d) => d.storageKey)));
      const records = visible
        .map((r) => ({
          ...r,
          documents: r.documents.map(({ storageKey, ...d }) => ({ ...withFormat(d), available: stored.has(storageKey) })),
          // A result reaches the patient only once a clinician has verified it.
          labTests: r.labTests.map(({ verifiedAt, results, ...test }) => ({ ...test, verified: !!verifiedAt, verifiedAt, results: verifiedAt ? results : '' })),
          invoices: r.invoices.map((invoice) => ({
            ...invoice,
            balance: Math.max(0, invoice.amount - invoice.amountPaid),
            items: invoice.items.map((item) => ({ ...item, kindLabel: CHARGE_KINDS[item.kind] })),
            payments: invoice.payments.map((p) => ({
              ...p,
              receiptNumber: formatReceiptNumber(p.receiptNumber),
              method: p.method ? PAYMENT_METHODS[p.method] : null,
            })),
          })),
        }));

      return { success: true, account, records };
    } catch (error: any) {
      return sendRouteError(reply, error);
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

    const format = detectDocumentFormat(buffer, data.filename);
    if (!format) return reply.status(415).send({ error: SUPPORTED_FORMATS_MESSAGE });
    const fileName = normalizeFileName(data.filename, format);

    // The file is kept in the database with its record, so it survives restarts.
    const created = await storeDocument({
      clinicId: record.clinicId,
      patientId: record.id,
      category: 'PATIENT_UPLOAD',
      fileName,
      mimeType: format.mimeType,
      fileSize: buffer.length,
      storageKey: generateStorageKey(fileName),
      uploadedByPatientAccountId: authUser.patientAccountId,
    }, buffer);
    const [document] = await withAvailability([created]);

    await recordAudit({
      entity: 'Document', recordId: document.id, clinicId: document.clinicId,
      action: 'CREATE', actorUserId: authUser.patientAccountId, actorRole: 'PATIENT',
      metadata: { patientId: record.id, fileName: document.fileName },
    });

    return { success: true, document: withFormat(document) };
  });

  // The patient's own copy of a prescription, to take to any pharmacy. Same
  // access rule as everything else here: only a consultation on one of their own
  // linked records, at a facility that is currently authorized.
  fastify.get('/patient-portal/consultations/:id/prescription/pdf', { preHandler: [authenticatePatient] }, async (request, reply) => {
    const authUser = getPatientAuthUser(request);
    const { id } = request.params as any;

    const consultation = await prisma.consultation.findFirst({
      where: { id, deletedAt: null },
      select: { patientId: true, _count: { select: { prescriptions: true } } },
    });
    if (!consultation) return reply.status(404).send({ error: 'Prescription not found' });
    const record = await findOwnRecord(authUser.patientAccountId, consultation.patientId);
    if (!record) return reply.status(404).send({ error: 'Prescription not found' });
    if (consultation._count.prescriptions === 0) return reply.status(404).send({ error: 'Prescription not found' });

    const built = await buildPrescriptionPdf(id, 'downloaded by the patient from the Bulamu Patient Portal');
    if (!built) return reply.status(404).send({ error: 'Prescription not found' });

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `inline; filename="prescription-${id}.pdf"`);
    return reply.send(built.pdf);
  });

  // A receipt for one of the patient's own payments, the same document the facility prints.
  fastify.get('/patient-portal/payments/:id/receipt/pdf', { preHandler: [authenticatePatient] }, async (request, reply) => {
    const authUser = getPatientAuthUser(request);
    const { id } = request.params as any;
    try {
      const payment = await prisma.patientPayment.findUnique({ where: { id }, select: { voidedAt: true, receiptNumber: true, invoice: { select: { patientId: true } } } });
      if (!payment || payment.voidedAt || !(await findOwnRecord(authUser.patientAccountId, payment.invoice.patientId))) {
        return reply.status(404).send({ error: 'Receipt not found' });
      }
      const built = await buildReceipt(id, 'downloaded by the patient from the Bulamu Patient Portal');
      if (!built) return reply.status(404).send({ error: 'Receipt not found' });
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `inline; filename="receipt-${formatReceiptNumber(payment.receiptNumber)}.pdf"`);
      return reply.send(built.pdf);
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // The patient's own referral letter, to carry to the facility they were referred to.
  fastify.get('/patient-portal/referrals/:id/letter', { preHandler: [authenticatePatient] }, async (request, reply) => {
    const authUser = getPatientAuthUser(request);
    const { id } = request.params as any;
    const referral = await prisma.referral.findUnique({
      where: { id },
      include: { patient: true, fromClinic: true, toClinic: { select: { name: true } }, referredBy: { select: { name: true, role: true } } },
    });
    if (!referral || !(await findOwnRecord(authUser.patientAccountId, referral.patientId))) {
      return reply.status(404).send({ error: 'Referral not found' });
    }
    const pdf = await generateReferralLetterPdf({ ...referralLetterInput(referral), fromClinicLogo: await facilityLogo(referral.fromClinicId), producedBy: 'downloaded by the patient from the Bulamu Patient Portal' });
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `inline; filename="referral-${id.slice(0, 8)}.pdf"`);
    return reply.send(pdf);
  });

  // The patient's own discharge summary.
  fastify.get('/patient-portal/admissions/:id/discharge-summary', { preHandler: [authenticatePatient] }, async (request, reply) => {
    const authUser = getPatientAuthUser(request);
    const { id } = request.params as any;
    const admission = await prisma.admission.findUnique({
      where: { id },
      include: {
        patient: true, ward: { select: { name: true } }, clinic: { select: { name: true, facilityCode: true } },
        attendingDoctor: { select: { name: true, role: true } }, dischargedBy: { select: { name: true, role: true } },
        referral: { select: { toClinic: { select: { name: true } } } },
      },
    });
    if (!admission || admission.status !== 'DISCHARGED' || !(await findOwnRecord(authUser.patientAccountId, admission.patientId))) {
      return reply.status(404).send({ error: 'Discharge summary not found' });
    }
    const pdf = await generateDischargeSummaryPdf({ ...dischargeSummaryInput(admission), clinicLogo: await facilityLogo(admission.clinicId), producedBy: 'downloaded by the patient from the Bulamu Patient Portal' });
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `inline; filename="discharge-summary-${id.slice(0, 8)}.pdf"`);
    return reply.send(pdf);
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

    return sendDocumentFile(reply, document);
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

    await removeDocument(document);

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
      return sendRouteError(reply, error, 400);
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

    // A facility that can no longer see the patient's records can no longer see
    // their history from other facilities either.
    await prisma.historyShare.updateMany({
      where: { patientAccountId: authUser.patientAccountId, clinicId: grant.clinicId, status: { in: ['REQUESTED', 'APPROVED'] } },
      data: { status: 'WITHDRAWN', endedAt: new Date() },
    });

    await recordAudit({
      entity: 'PatientAccessGrant', recordId: grant.id, clinicId: grant.clinicId,
      action: 'UPDATE', actorUserId: authUser.patientAccountId, actorRole: 'PATIENT',
      metadata: { status: 'REVOKED' },
    });

    return { success: true, grant: updated };
  });
}
