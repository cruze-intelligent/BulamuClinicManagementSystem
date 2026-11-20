import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { assertClinicMatch, getAuthUser } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { recordAudit } from '../lib/audit';
import { sendRouteError } from '../lib/http-error';
import { patientIdText, sexAgeText } from '../lib/patient-text';
import { imagingUnitFor, parseImagingReport, parseImagingRequest, REPORT_ROLES, REQUEST_ROLES, WORKLIST_ROLES, requesterName } from '../lib/imaging';
import { notifyImagingReported, notifyImagingRequested } from '../lib/notifications';

const VIEW = {
  patient: { select: { id: true, name: true, sex: true, dateOfBirth: true, dateOfBirthEstimated: true, patientNumber: true } },
  department: { select: { id: true, name: true } },
} as const;

type Row = Awaited<ReturnType<typeof prisma.imagingRequest.findFirstOrThrow<{ include: typeof VIEW }>>>;

const view = (r: Row) => ({
  id: r.id,
  modality: r.modality,
  examination: r.examination,
  clinicalInfo: r.clinicalInfo,
  urgent: r.urgent,
  status: r.status,
  requestedBy: r.requestedBy,
  requestedAt: r.createdAt,
  consultationId: r.consultationId,
  unit: r.department,
  findings: r.findings,
  impression: r.impression,
  reportedBy: r.reportedBy,
  reportedAt: r.reportedAt,
  cancelReason: r.cancelReason,
  patient: { id: r.patient.id, name: r.patient.name, patientId: patientIdText(r.patient.patientNumber), sexAge: sexAgeText(r.patient) },
});

const nameOf = async (userId: string) => (await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? 'A clinician';

/**
 * Imaging - X-ray, ultrasound scans, CT... Clinicians request it (at a visit,
 * or here); the request goes to the imaging unit's worklist; the radiographer
 * or sonographer writes the report, and the requester is told.
 */
export async function imagingRoutes(fastify: FastifyInstance) {
  // The worklist: waiting requests (urgent first, then oldest first), or the reports of the last 30 days.
  fastify.get('/imaging', { preHandler: [requireRole(...WORKLIST_ROLES)] }, async (request, reply) => {
    const { clinicId } = getAuthUser(request);
    const query = (request.query ?? {}) as { status?: string; unitId?: string };
    const status = query.status === 'REPORTED' || query.status === 'CANCELLED' ? query.status : 'REQUESTED';
    try {
      const rows = await prisma.imagingRequest.findMany({
        where: {
          clinicId, status,
          ...(query.unitId ? { departmentId: query.unitId } : {}),
          ...(status === 'REQUESTED' ? {} : { updatedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }),
        },
        orderBy: status === 'REQUESTED' ? [{ urgent: 'desc' }, { createdAt: 'asc' }] : [{ updatedAt: 'desc' }],
        take: 200,
        include: VIEW,
      });
      return { success: true, requests: rows.map(view) };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // A patient's imaging, newest first.
  fastify.get('/patients/:patientId/imaging', { preHandler: [requireRole(...WORKLIST_ROLES)] }, async (request, reply) => {
    const { patientId } = request.params as { patientId: string };
    const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { clinicId: true } });
    if (!patient) return reply.status(404).send({ error: 'Patient not found' });
    if (!assertClinicMatch(request, reply, patient.clinicId)) return;
    const rows = await prisma.imagingRequest.findMany({ where: { patientId, clinicId: patient.clinicId }, orderBy: { createdAt: 'desc' }, include: VIEW });
    return { success: true, requests: rows.map(view) };
  });

  // Request imaging outside a visit (at a visit it comes with the visit, offline too).
  fastify.post('/imaging', { preHandler: [requireRole(...REQUEST_ROLES)] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const body = (request.body ?? {}) as any;
    const parsed = parseImagingRequest(body);
    if ('error' in parsed) return reply.status(400).send({ error: parsed.error });
    const patient = await prisma.patient.findUnique({ where: { id: String(body.patientId ?? '') } });
    if (!patient || patient.deletedAt) return reply.status(404).send({ error: 'Patient not found' });
    if (!assertClinicMatch(request, reply, patient.clinicId)) return;
    try {
      const created = await prisma.imagingRequest.create({
        data: {
          ...parsed, clinicId: patient.clinicId, patientId: patient.id,
          departmentId: await imagingUnitFor(patient.clinicId, parsed.modality),
          requestedBy: requesterName(body.requestedBy) ?? (await nameOf(authUser.userId)), requestedByUserId: authUser.userId,
        },
        include: VIEW,
      });
      await recordAudit({ entity: 'ImagingRequest', recordId: created.id, clinicId: patient.clinicId, action: 'CREATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { modality: created.modality, examination: created.examination } });
      await notifyImagingRequested({ clinicId: patient.clinicId, patientName: patient.name, examination: created.examination, urgent: created.urgent, requestedByUserId: authUser.userId }, (m) => fastify.log.warn(m));
      return { success: true, request: view(created) };
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
    }
  });

  // The report: findings and impression. Correctable by whoever reports, and each change is audited.
  fastify.patch('/imaging/:id/report', { preHandler: [requireRole(...REPORT_ROLES)] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as { id: string };
    const parsed = parseImagingReport(request.body);
    if ('error' in parsed) return reply.status(400).send({ error: parsed.error });
    const existing = await prisma.imagingRequest.findUnique({ where: { id }, include: { patient: { select: { name: true } } } });
    if (!existing) return reply.status(404).send({ error: 'Imaging request not found' });
    if (!assertClinicMatch(request, reply, existing.clinicId)) return;
    if (existing.status === 'CANCELLED') return reply.status(409).send({ error: 'This request was cancelled' });
    try {
      const updated = await prisma.imagingRequest.update({
        where: { id },
        data: { ...parsed, status: 'REPORTED', reportedBy: await nameOf(authUser.userId), reportedByUserId: authUser.userId, reportedAt: new Date() },
        include: VIEW,
      });
      await recordAudit({ entity: 'ImagingRequest', recordId: id, clinicId: existing.clinicId, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { report: existing.status === 'REPORTED' ? 'corrected' : 'written' } });
      if (existing.status !== 'REPORTED') {
        const visit = existing.consultationId
          ? await prisma.consultation.findFirst({ where: { id: existing.consultationId, awaitingResults: true, deletedAt: null }, select: { id: true, patientId: true } })
          : null;
        await notifyImagingReported({ clinicId: existing.clinicId, patientName: existing.patient.name, examination: existing.examination, requestedByUserId: existing.requestedByUserId, reportedByUserId: authUser.userId, visit }, (m) => fastify.log.warn(m));
      }
      return { success: true, request: view(updated) };
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
    }
  });

  // Cancelled (requested in error, or no longer needed), with the reason.
  fastify.post('/imaging/:id/cancel', { preHandler: [requireRole(...WORKLIST_ROLES)] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as { id: string };
    const reason = typeof (request.body as any)?.reason === 'string' ? (request.body as any).reason.trim().slice(0, 300) : '';
    if (!reason) return reply.status(400).send({ error: 'Say why the request is cancelled' });
    const existing = await prisma.imagingRequest.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'Imaging request not found' });
    if (!assertClinicMatch(request, reply, existing.clinicId)) return;
    if (existing.status !== 'REQUESTED') return reply.status(409).send({ error: existing.status === 'REPORTED' ? 'This request has been reported and can not be cancelled' : 'This request was already cancelled' });
    const updated = await prisma.imagingRequest.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason }, include: VIEW });
    await recordAudit({ entity: 'ImagingRequest', recordId: id, clinicId: existing.clinicId, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { status: 'CANCELLED', reason } });
    return { success: true, request: view(updated) };
  });
}
