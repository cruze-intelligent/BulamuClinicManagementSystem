import { FastifyInstance, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireRole } from '../middleware/rbac.middleware';
import { authenticate, getAuthUser, resolveClinicScope } from '../middleware/auth.middleware';
import { recordAudit } from '../lib/audit';
import { sendMail, facilityDetailsReviewedEmail, MailResult } from '../lib/mailer';
import { alertOperator, deliveryNote, frontendUrl } from '../lib/operator-alerts';
import { REAL_FACILITY } from '../lib/facility';
import {
  DETAIL_SELECT, DetailChanges, FacilityDetailsError, changeAllowance, changeRows, describeChanges,
  requestDetailChange, reviewDetailChange, withdrawDetailChange,
} from '../lib/facility-details';
import { sendRouteError } from '../lib/http-error';

const HISTORY_SHOWN = 10;

function sendDetailsError(reply: FastifyReply, error: unknown) {
  if (error instanceof FacilityDetailsError) return reply.status(error.statusCode).send({ error: error.message });
  return sendRouteError(reply, error, 400);
}

const facilityAdmin = (clinicId: string) =>
  prisma.user.findFirst({ where: { clinicId, role: 'ADMIN' }, orderBy: { createdAt: 'asc' }, select: { email: true, name: true } });

export async function facilityDetailsRoutes(fastify: FastifyInstance) {
  // The facility's details as they print on its documents. Anyone at the
  // facility sees them; its administrator also sees how many changes they can
  // still make themselves, any change waiting for review, and past changes.
  fastify.get('/clinics/:id/details', { preHandler: [authenticate] }, async (request, reply) => {
    const clinicId = resolveClinicScope(request, reply, (request.params as { id: string }).id);
    if (!clinicId) return;
    try {
      const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { id: true, facilityCode: true, deletedAt: true, ...DETAIL_SELECT } });
      if (!clinic || clinic.deletedAt) return reply.status(404).send({ error: 'Facility not found' });
      const { deletedAt: _deletedAt, ...details } = clinic;
      const role = getAuthUser(request).role;
      if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') return { success: true, facility: details };

      const [allowance, recent] = await Promise.all([
        changeAllowance(prisma, clinicId),
        prisma.facilityDetailChange.findMany({ where: { clinicId }, orderBy: { createdAt: 'desc' }, take: HISTORY_SHOWN }),
      ]);
      const history = await describeChanges(recent);
      return { success: true, facility: details, allowance, pending: history.find((row) => row.status === 'PENDING') ?? null, history };
    } catch (error) {
      return sendRouteError(reply, error);
    }
  });

  // The facility administrator changes the details. Within the allowance the
  // change is made at once (200); past it, the change waits for Bulamu (202).
  fastify.patch('/clinics/:id/details', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const clinicId = resolveClinicScope(request, reply, (request.params as { id: string }).id);
    if (!clinicId) return;
    const authUser = getAuthUser(request);
    try {
      const result = await requestDetailChange({ clinicId, userId: authUser.userId, body: request.body });
      const changes = result.change.changes as DetailChanges;
      await recordAudit({
        entity: 'FacilityDetails', recordId: result.change.id, clinicId, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { outcome: result.outcome, fields: Object.keys(changes) },
      });

      if (result.outcome === 'PENDING') {
        void (async () => {
          const [clinic, requester] = await Promise.all([
            prisma.clinic.findUnique({ where: { id: clinicId }, select: { name: true, facilityCode: true } }),
            prisma.user.findUnique({ where: { id: authUser.userId }, select: { name: true, email: true } }),
          ]);
          await alertOperator({
            subject: `Facility details to review - ${clinic?.name}`,
            heading: 'A facility wants to change its details',
            intro: `This facility has already changed its details ${result.allowance.limit} times in the last 12 months, so this change waits for your review in Facility Management.`,
            facts: [
              ['Facility', clinic?.name],
              ['Facility ID', clinic?.facilityCode],
              ['Asked by', requester ? `${requester.name} <${requester.email}>` : null],
              ...changeRows(changes).map(([label, from, to]): [string, string] => [label, `${from} -> ${to}`]),
              ['Why', result.change.note],
            ],
            ctaPath: '/super-admin',
            ctaLabel: 'Review the change',
          });
        })().catch((error) => fastify.log.error(error, 'Facility change alert failed'));
        return reply.status(202).send({
          success: true, outcome: 'PENDING', change: result.change, facility: result.clinic, allowance: result.allowance,
          message: 'Sent to Bulamu for review. The details stay as they are until a Bulamu administrator checks the change - you will get an email when they do.',
        });
      }

      return { success: true, outcome: 'APPLIED', change: result.change, facility: result.clinic, allowance: result.allowance, message: 'Facility details saved. Your documents now print the new details.' };
    } catch (error) {
      return sendDetailsError(reply, error);
    }
  });

  // The facility administrator takes back a change before Bulamu reviews it.
  fastify.delete('/clinics/:id/details/pending', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const clinicId = resolveClinicScope(request, reply, (request.params as { id: string }).id);
    if (!clinicId) return;
    const authUser = getAuthUser(request);
    try {
      const change = await withdrawDetailChange(clinicId, authUser.userId);
      await recordAudit({ entity: 'FacilityDetails', recordId: change.id, clinicId, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { outcome: 'WITHDRAWN' } });
      return { success: true, change };
    } catch (error) {
      return sendDetailsError(reply, error);
    }
  });

  // Changes waiting for a Bulamu administrator, oldest first.
  fastify.get('/super-admin/facility-changes', { preHandler: [requireRole('SUPER_ADMIN')] }, async (_request, reply) => {
    try {
      const rows = await prisma.facilityDetailChange.findMany({
        where: { status: 'PENDING', clinic: { is: REAL_FACILITY } },
        orderBy: { createdAt: 'asc' },
        include: { clinic: { select: { id: true, name: true, facilityCode: true } } },
      });
      const changes = await describeChanges(rows);
      const recentCounts = await Promise.all(changes.map((row) => changeAllowance(prisma, row.clinicId)));
      return { success: true, changes: changes.map((row, i) => ({ ...row, rows: changeRows(row.changes as DetailChanges), changesThisYear: recentCounts[i].used })) };
    } catch (error) {
      return sendRouteError(reply, error);
    }
  });

  for (const decision of ['approve', 'reject'] as const) {
    fastify.post(`/super-admin/facility-changes/:id/${decision}`, { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
      const { id } = request.params as { id: string };
      const authUser = getAuthUser(request);
      try {
        const { change } = await reviewDetailChange({ id, reviewerId: authUser.userId, approve: decision === 'approve', note: (request.body as { note?: unknown } | null)?.note });
        await recordAudit({
          entity: 'FacilityDetails', recordId: change.id, clinicId: change.clinicId, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role,
          metadata: { outcome: change.status, ...(change.reviewNote ? { note: change.reviewNote } : {}) },
        });

        // The facility hears the decision; a failed email never undoes it.
        void (async () => {
          const [clinic, admin] = await Promise.all([
            prisma.clinic.findUnique({ where: { id: change.clinicId }, select: { name: true, facilityCode: true } }),
            facilityAdmin(change.clinicId),
          ]);
          let result: MailResult | null = null;
          if (clinic && admin) {
            result = await sendMail({
              to: admin.email,
              subject: decision === 'approve' ? `Facility details updated - ${clinic.name} - Bulamu` : `Facility details not changed - ${clinic.name} - Bulamu`,
              html: facilityDetailsReviewedEmail(clinic.name, decision === 'approve', changeRows(change.changes as DetailChanges), frontendUrl('/facility'), {
                adminName: admin.name, facilityCode: clinic.facilityCode, reason: change.reviewNote,
              }),
            });
          }
          if (result && !result.sent) fastify.log.warn(`Facility change email not sent: ${deliveryNote(result)}`);
        })().catch((error) => fastify.log.error(error, 'Facility change email failed'));

        return { success: true, change };
      } catch (error) {
        return sendDetailsError(reply, error);
      }
    });
  }
}
