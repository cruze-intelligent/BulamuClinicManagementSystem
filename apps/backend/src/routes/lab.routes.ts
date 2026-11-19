import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate, assertClinicMatch, getAuthUser, resolveClinicScope, worksAs, type AuthUser } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { recordAudit } from '../lib/audit';
import { notifyLabOrdered, notifyLabResultReady, notifyLabResultToOrderer } from '../lib/notifications';
import { sendRouteError } from '../lib/http-error';
import { buildLabResultsPdf } from '../lib/consultation-records';
import { documentProducer } from '../lib/document-signer';
import { parseLabValues, summariseValues } from '../lib/lab-values';
import { Prisma } from '@prisma/client';

export async function labRoutes(fastify: FastifyInstance) {

  // Get lab tests for patient
  fastify.get('/lab/patient/:patientId', { preHandler: [authenticate] }, async (request, reply) => {
    const { patientId } = request.params as any;

    try {
      const patient = await prisma.patient.findUnique({ where: { id: patientId } });
      if (!patient) {
        return reply.status(404).send({ error: 'Patient not found' });
      }
      if (!assertClinicMatch(request, reply, patient.clinicId)) return;

      const tests = await prisma.labTest.findMany({
        where: { patientId, deletedAt: null },
        orderBy: { createdAt: 'desc' }
      });

      return { success: true, tests };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // Order lab test
  fastify.post('/lab', { preHandler: [authenticate] }, async (request, reply) => {
    const { patientId, consultationId, testName, orderedBy } = request.body as any;

    try {
      const patient = await prisma.patient.findUnique({ where: { id: patientId } });
      if (!patient) {
        return reply.status(404).send({ error: 'Patient not found' });
      }
      if (!assertClinicMatch(request, reply, patient.clinicId)) return;

      const authUser = getAuthUser(request);
      const test = await prisma.labTest.create({
        data: { patientId, consultationId, testName, orderedBy, orderedByUserId: authUser.userId, results: '' }
      });

      await notifyLabOrdered(
        { clinicId: patient.clinicId, patientName: patient.name, testName: test.testName, orderedByUserId: authUser.userId },
        (message) => fastify.log.warn(message)
      );

      return { success: true, test };
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
    }
  });

  // Every lab test at the facility, newest first - one request (the Lab page
  // used to make one request per patient).
  fastify.get('/lab/clinic/:clinicId', { preHandler: [authenticate] }, async (request, reply) => {
    const clinicId = resolveClinicScope(request, reply, (request.params as { clinicId: string }).clinicId);
    if (!clinicId) return;
    try {
      const tests = await prisma.labTest.findMany({
        where: { deletedAt: null, patient: { clinicId, deletedAt: null } },
        include: LAB_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
      return { success: true, tests };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // The patient's results to print and take away - this test and the patient's
  // other results from the same day or visit (?only=1 for this test alone).
  fastify.get('/lab/:id/results/pdf', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const only = (request.query as { only?: string }).only === '1';
    try {
      const existing = await prisma.labTest.findFirst({ where: { id, deletedAt: null }, select: { patient: { select: { clinicId: true } } } });
      if (!existing) return reply.status(404).send({ error: 'Lab test not found' });
      if (!assertClinicMatch(request, reply, existing.patient.clinicId)) return;
      const built = await buildLabResultsPdf(id, { only, producedBy: await documentProducer(getAuthUser(request).userId) });
      if (!built) return reply.status(404).send({ error: 'Lab test not found' });
      if ('error' in built) return reply.status(built.status).send({ error: built.error });
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `inline; filename="lab-results-${id.slice(0, 8)}.pdf"`);
      return reply.send(built.pdf);
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // Enter (or, before it is verified, correct) a result - or cancel the test.
  // The person entering it is recorded; the clinician who ordered it is asked
  // to review it. The patient is told only once a clinician has verified it.
  fastify.patch('/lab/:id', { preHandler: [requireRole(...RESULT_ROLES)] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { results, status, values: rawValues, comment: rawComment } = (request.body ?? {}) as { results?: unknown; status?: unknown; values?: unknown; comment?: unknown };

    try {
      const existing = await prisma.labTest.findUnique({ where: { id }, include: { patient: true } });
      if (!existing || existing.deletedAt) return reply.status(404).send({ error: 'Lab test not found' });
      if (!assertClinicMatch(request, reply, existing.patient.clinicId)) return;
      if (existing.verifiedAt) {
        return reply.status(409).send({ error: 'This result has been verified and is locked. To correct it, amend it with a reason.' });
      }
      const authUser = getAuthUser(request);

      if (status === 'CANCELLED') {
        if (existing.status === 'COMPLETED') return reply.status(409).send({ error: 'A test with a result can not be cancelled.' });
        const test = await prisma.labTest.update({ where: { id }, data: { status: 'CANCELLED' }, include: LAB_INCLUDE });
        await recordAudit({ entity: 'LabTest', recordId: id, clinicId: existing.patient.clinicId, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { status: 'CANCELLED' } });
        return { success: true, test };
      }

      // Entered value by value (a blood count, kidney tests...) or as one text result.
      const parsedValues = parseLabValues(rawValues);
      if ('error' in parsedValues) return reply.status(400).send({ error: parsedValues.error });
      const comment = typeof rawComment === 'string' ? rawComment.trim().slice(0, 1000) || null : null;
      const values = parsedValues.values;
      if (values && values.length === 0) return reply.status(400).send({ error: 'Enter at least one value' });
      const text = values ? summariseValues(values, comment) : typeof results === 'string' ? results.trim() : '';
      if (!text) return reply.status(400).send({ error: 'Enter the result' });
      if (text.length > MAX_RESULT) return reply.status(400).send({ error: `The result is too long (${MAX_RESULT} characters max)` });
      if (existing.status === 'CANCELLED') return reply.status(409).send({ error: 'This test was cancelled.' });

      const now = new Date();
      const test = await prisma.labTest.update({
        where: { id },
        data: { results: text, values: values ?? Prisma.DbNull, comment: values ? comment : null, status: 'COMPLETED', completedAt: existing.completedAt ?? now, resultedByUserId: authUser.userId, resultedAt: now },
        include: LAB_INCLUDE,
      });
      await recordAudit({
        entity: 'LabTest', recordId: id, clinicId: existing.patient.clinicId, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { result: existing.status === 'COMPLETED' ? 'corrected before verification' : 'entered' },
      });

      if (existing.status !== 'COMPLETED') {
        const visit = existing.consultationId
          ? await prisma.consultation.findFirst({ where: { id: existing.consultationId, awaitingResults: true, deletedAt: null }, select: { id: true, patientId: true } })
          : null;
        await notifyLabResultToOrderer({
          clinicId: existing.patient.clinicId, patientName: existing.patient.name, testName: test.testName,
          orderedByUserId: existing.orderedByUserId, recordedByUserId: authUser.userId, visit,
        }, (message) => fastify.log.warn(message));
      }
      return { success: true, test };
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
    }
  });

  // A clinician checks the result and releases it: it is locked, and the
  // patient is told it is ready.
  fastify.post('/lab/:id/verify', { preHandler: [requireRole(...RESULT_ROLES)] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!mayVerify(getAuthUser(request))) return reply.status(403).send({ error: 'Only a clinician, the administrator or a lab supervisor given the right may verify results' });
    try {
      const existing = await prisma.labTest.findUnique({ where: { id }, include: { patient: true } });
      if (!existing || existing.deletedAt) return reply.status(404).send({ error: 'Lab test not found' });
      if (!assertClinicMatch(request, reply, existing.patient.clinicId)) return;
      if (existing.status !== 'COMPLETED' || !existing.results.trim()) return reply.status(409).send({ error: 'There is no result to verify yet.' });
      if (existing.verifiedAt) return reply.status(409).send({ error: 'This result is already verified.' });

      const authUser = getAuthUser(request);
      const test = await prisma.labTest.update({ where: { id }, data: { verifiedByUserId: authUser.userId, verifiedAt: new Date() }, include: LAB_INCLUDE });
      await recordAudit({ entity: 'LabTest', recordId: id, clinicId: existing.patient.clinicId, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { result: 'verified' } });
      await notifyLabResultReady({ patient: existing.patient, testName: test.testName }, (message) => fastify.log.warn(message));
      return { success: true, test };
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
    }
  });

  // Correct a verified result. The reason is kept in the activity log, and the
  // corrected result has to be verified again.
  fastify.post('/lab/:id/amend', { preHandler: [requireRole(...RESULT_ROLES)] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!mayVerify(getAuthUser(request))) return reply.status(403).send({ error: 'Only a clinician, the administrator or a lab supervisor given the right may amend a verified result' });
    const { results, reason, values: rawValues, comment: rawComment } = (request.body ?? {}) as { results?: unknown; reason?: unknown; values?: unknown; comment?: unknown };
    const parsedValues = parseLabValues(rawValues);
    if ('error' in parsedValues) return reply.status(400).send({ error: parsedValues.error });
    const values = parsedValues.values;
    const comment = typeof rawComment === 'string' ? rawComment.trim().slice(0, 1000) || null : null;
    const text = values?.length ? summariseValues(values, comment) : typeof results === 'string' ? results.trim() : '';
    const why = typeof reason === 'string' ? reason.trim() : '';
    if (!text) return reply.status(400).send({ error: 'Enter the corrected result' });
    if (text.length > MAX_RESULT) return reply.status(400).send({ error: `The result is too long (${MAX_RESULT} characters max)` });
    if (!why) return reply.status(400).send({ error: 'Say why the result is being amended' });

    try {
      const existing = await prisma.labTest.findUnique({ where: { id }, include: { patient: true } });
      if (!existing || existing.deletedAt) return reply.status(404).send({ error: 'Lab test not found' });
      if (!assertClinicMatch(request, reply, existing.patient.clinicId)) return;
      if (!existing.verifiedAt) return reply.status(409).send({ error: 'Only a verified result is amended - this one can still be corrected directly.' });

      const authUser = getAuthUser(request);
      const now = new Date();
      const test = await prisma.labTest.update({
        where: { id },
        data: { results: text, values: values?.length ? values : Prisma.DbNull, comment: values?.length ? comment : null, resultedByUserId: authUser.userId, resultedAt: now, verifiedByUserId: null, verifiedAt: null },
        include: LAB_INCLUDE,
      });
      await recordAudit({
        entity: 'LabTest', recordId: id, clinicId: existing.patient.clinicId, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { result: 'amended after verification', reason: why.slice(0, 300) },
      });
      return { success: true, test };
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
    }
  });
}

// Entering results: the lab technician, nurses who run the lab where there is
// no technician, and the clinicians. Verifying
// (releasing a result to the patient): clinicians and the administrator.
const RESULT_ROLES = ['LAB_TECH', 'NURSE', 'DOCTOR', 'ADMIN'] as const;
const VERIFY_ROLES = ['DOCTOR', 'ADMIN'] as const;
/** Clinicians and the administrator verify; so does anyone the administrator has given the right (a lab supervisor). */
const mayVerify = (user: AuthUser) => worksAs(user, ...VERIFY_ROLES) || !!user.canVerifyLab;
const MAX_RESULT = 2000;

const LAB_INCLUDE = {
  // Sex and birth date choose the reference ranges for a result entered value by value.
  patient: { select: { id: true, name: true, phone: true, sex: true, dateOfBirth: true } },
  resultedBy: { select: { name: true, role: true } },
  verifiedBy: { select: { name: true, role: true } },
} as const;
