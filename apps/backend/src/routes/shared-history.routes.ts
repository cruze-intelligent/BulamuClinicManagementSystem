import { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma';
import { getAuthUser } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { authenticatePatient, getPatientAuthUser } from '../middleware/patient-auth.middleware';
import { recordAudit } from '../lib/audit';
import { generateOtp } from '../lib/patient-account';
import { hashToken } from '../lib/crypto';
import { historyShareOtpEmail, sendMail } from '../lib/mailer';
import { notifyPatient, notifyStaff } from '../lib/notifications';
import { activeShare, authorisedClinicIds, buildSharedHistory } from '../lib/shared-history';

/**
 * A patient's history from other facilities, shared only with the patient's
 * approval. Staff at a facility can ASK; the patient approves (on the facility
 * device with their password or an emailed code, or from their own Patient
 * Portal), and can withdraw it at any time. Only clinicians read it, and every
 * read is written to the audit log.
 */

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RATE_LIMIT = { max: 10, timeWindow: '15 minutes' };
const APPROVE_RATE_LIMIT = { max: 8, timeWindow: '15 minutes' };
const CLINICIANS = ['DOCTOR', 'NURSE'];

export async function sharedHistoryRoutes(fastify: FastifyInstance) {
  const log = (message: string) => fastify.log.warn(message);

  // The patient at the caller's facility, with a portal account the facility is allowed to use.
  async function linkedPatient(patientId: string, clinicId: string) {
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true, name: true, clinicId: true, deletedAt: true, patientAccountId: true, patientAccount: { select: { id: true, email: true, password: true, status: true } } },
    });
    if (!patient || patient.deletedAt || patient.clinicId !== clinicId) return { error: 404 as const };
    const account = patient.patientAccount;
    if (!account || account.status !== 'ACTIVE') return { patient, account: null };
    const authorised = await authorisedClinicIds(account.id);
    return { patient, account: authorised.has(clinicId) ? account : null };
  }

  const otherFacilityCount = async (patientAccountId: string, clinicId: string) => {
    const allowed = await authorisedClinicIds(patientAccountId);
    allowed.delete(clinicId);
    return prisma.patient.count({ where: { patientAccountId, deletedAt: null, clinicId: { in: [...allowed] } } });
  };

  // Where things stand for this patient at this facility.
  fastify.get('/patients/:id/shared-history/status', { preHandler: [requireRole('DOCTOR', 'NURSE', 'ADMIN')] }, async (request, reply) => {
    const { clinicId } = getAuthUser(request);
    const found = await linkedPatient((request.params as any).id, clinicId);
    if ('error' in found) return reply.status(404).send({ error: 'Patient not found' });
    if (!found.account) return { success: true, linked: false, share: null, otherFacilities: 0 };

    const share = await prisma.historyShare.findFirst({
      where: { patientAccountId: found.account.id, clinicId, status: { in: ['REQUESTED', 'APPROVED'] } },
      orderBy: { requestedAt: 'desc' },
      select: { id: true, status: true, requestedAt: true, approvedAt: true, approvalMethod: true },
    });
    return { success: true, linked: true, share, otherFacilities: await otherFacilityCount(found.account.id, clinicId) };
  });

  // Ask the patient. They are told in their portal and by email; nothing is shared yet.
  fastify.post('/patients/:id/shared-history/request', { preHandler: [requireRole(...CLINICIANS)] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const found = await linkedPatient((request.params as any).id, authUser.clinicId);
    if ('error' in found) return reply.status(404).send({ error: 'Patient not found' });
    if (!found.account) {
      return reply.status(409).send({ error: 'This patient has no Patient Portal account linked to your facility. Link their account first (they approve that too).' });
    }

    const existing = await prisma.historyShare.findFirst({
      where: { patientAccountId: found.account.id, clinicId: authUser.clinicId, status: { in: ['REQUESTED', 'APPROVED'] } },
    });
    if (existing) return { success: true, share: existing };

    const share = await prisma.historyShare.create({
      data: { patientAccountId: found.account.id, clinicId: authUser.clinicId, requestedByUserId: authUser.userId },
    });
    await recordAudit({ entity: 'HistoryShare', recordId: share.id, clinicId: authUser.clinicId, action: 'CREATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { patientId: found.patient.id, status: 'REQUESTED' } });

    const clinic = await prisma.clinic.findUnique({ where: { id: authUser.clinicId }, select: { name: true } });
    await notifyPatient({
      type: 'HISTORY_ACCESS_REQUESTED',
      patientAccountId: found.account.id,
      clinicId: authUser.clinicId,
      title: `${clinic?.name ?? 'A facility'} is asking to see your history`,
      body: `${clinic?.name ?? 'A facility'} would like to see your records from the other facilities you have visited (allergies, diagnoses, medicines, lab results and hospital stays) so they can treat you safely. Nothing is shared unless you approve. Open the Access page to approve or decline.`,
      link: '/patient-portal/access',
      emailSummary: 'A facility you visited is asking to see your health records from other facilities. Nothing is shared unless you approve. Sign in to your Patient Portal to approve or decline.',
      log,
    });
    return { success: true, share };
  });

  // Email the patient a one-time code, for approving at the facility.
  fastify.post('/patients/:id/shared-history/otp', { preHandler: [requireRole(...CLINICIANS)], config: { rateLimit: OTP_RATE_LIMIT } }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const found = await linkedPatient((request.params as any).id, authUser.clinicId);
    if ('error' in found) return reply.status(404).send({ error: 'Patient not found' });
    if (!found.account) return reply.status(409).send({ error: 'This patient has no Patient Portal account linked to your facility' });

    const code = generateOtp();
    await prisma.patientAccessOtp.deleteMany({
      where: { patientAccountId: found.account.id, clinicId: authUser.clinicId, purpose: 'HISTORY' },
    });
    await prisma.patientAccessOtp.create({
      data: { patientAccountId: found.account.id, clinicId: authUser.clinicId, purpose: 'HISTORY', codeHash: hashToken(code), expiresAt: new Date(Date.now() + OTP_TTL_MS) },
    });
    const clinic = await prisma.clinic.findUnique({ where: { id: authUser.clinicId }, select: { name: true } });
    const mail = await sendMail({ to: found.account.email, subject: 'Your Bulamu approval code', html: historyShareOtpEmail(clinic?.name ?? 'A Bulamu facility', code) });
    if (!mail.sent) fastify.log.info(`History-sharing code for ${found.account.email}: ${code}`);

    return {
      success: true,
      message: 'An approval code was sent to the patient\'s email',
      ...(process.env.NODE_ENV !== 'production' ? { devOtp: code } : {}),
    };
  });

  // The patient approves here, at the facility, with their own password or the emailed code.
  fastify.post('/patients/:id/shared-history/approve', { preHandler: [requireRole(...CLINICIANS)], config: { rateLimit: APPROVE_RATE_LIMIT } }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { method, password, otp } = request.body as any;
    if (method !== 'PIN' && method !== 'OTP') return reply.status(400).send({ error: 'method must be PIN or OTP' });

    const found = await linkedPatient((request.params as any).id, authUser.clinicId);
    if ('error' in found) return reply.status(404).send({ error: 'Patient not found' });
    if (!found.account) return reply.status(409).send({ error: 'This patient has no Patient Portal account linked to your facility' });
    const account = found.account;

    if (method === 'PIN') {
      if (!password || !(await bcrypt.compare(String(password), account.password))) {
        return reply.status(401).send({ error: 'Incorrect password' });
      }
    } else {
      const row = await prisma.patientAccessOtp.findFirst({
        where: { patientAccountId: account.id, clinicId: authUser.clinicId, purpose: 'HISTORY', usedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      if (!otp || !row || row.expiresAt < new Date() || row.codeHash !== hashToken(String(otp))) {
        return reply.status(401).send({ error: 'Incorrect or expired code' });
      }
      await prisma.patientAccessOtp.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    }

    const pending = await prisma.historyShare.findFirst({
      where: { patientAccountId: account.id, clinicId: authUser.clinicId, status: { in: ['REQUESTED', 'APPROVED'] } },
    });
    if (pending?.status === 'APPROVED') return { success: true, share: pending };
    const share = pending
      ? await prisma.historyShare.update({ where: { id: pending.id }, data: { status: 'APPROVED', approvedAt: new Date(), approvalMethod: method } })
      : await prisma.historyShare.create({
          data: { patientAccountId: account.id, clinicId: authUser.clinicId, requestedByUserId: authUser.userId, status: 'APPROVED', approvedAt: new Date(), approvalMethod: method },
        });

    await approvedSideEffects(share, { actorUserId: authUser.userId, actorRole: authUser.role, patientId: found.patient.id }, log);
    return { success: true, share };
  });

  // Read it: clinicians only, only while the patient's approval stands, and every read is logged.
  fastify.get('/patients/:id/shared-history', { preHandler: [requireRole(...CLINICIANS)] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const found = await linkedPatient((request.params as any).id, authUser.clinicId);
    if ('error' in found) return reply.status(404).send({ error: 'Patient not found' });
    const share = found.account ? await activeShare(found.account.id, authUser.clinicId) : null;
    if (!found.account || !share) {
      return reply.status(403).send({ error: 'The patient has not approved sharing their history with your facility' });
    }

    const facilities = await buildSharedHistory(found.account.id, authUser.clinicId);
    await recordAudit({
      entity: 'SharedHistory', recordId: found.patient.id, clinicId: authUser.clinicId, action: 'VIEW',
      actorUserId: authUser.userId, actorRole: authUser.role,
      metadata: { patientAccountId: found.account.id, shareId: share.id, facilities: facilities.map((f) => f.facility.name) },
    });
    return { success: true, approvedAt: share.approvedAt, facilities };
  });

  // ---- The patient's side --------------------------------------------------------

  fastify.get('/patient-portal/history-sharing', { preHandler: [authenticatePatient] }, async (request) => {
    const { patientAccountId } = getPatientAuthUser(request);
    const shares = await prisma.historyShare.findMany({
      where: { patientAccountId },
      include: { clinic: { select: { name: true } } },
      orderBy: { requestedAt: 'desc' },
    });
    // Who has looked, and when - the patient's own view of the audit trail.
    const views = await prisma.auditLog.findMany({
      where: { entity: 'SharedHistory', action: 'VIEW', metadata: { path: ['patientAccountId'], equals: patientAccountId } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { clinicId: true, createdAt: true },
    });
    const clinics = await prisma.clinic.findMany({ where: { id: { in: [...new Set(views.map((v) => v.clinicId))] } }, select: { id: true, name: true } });
    const clinicName = new Map(clinics.map((c) => [c.id, c.name]));
    return {
      success: true,
      shares: shares.map((s) => ({
        id: s.id, facility: s.clinic.name, status: s.status, requestedAt: s.requestedAt, approvedAt: s.approvedAt, approvalMethod: s.approvalMethod, endedAt: s.endedAt,
      })),
      views: views.map((v) => ({ facility: clinicName.get(v.clinicId) ?? 'A facility', at: v.createdAt })),
    };
  });

  const patientDecision = (to: 'APPROVED' | 'DECLINED' | 'WITHDRAWN') => async (request: any, reply: any) => {
    const { patientAccountId } = getPatientAuthUser(request);
    const share = await prisma.historyShare.findFirst({ where: { id: request.params.id, patientAccountId } });
    if (!share) return reply.status(404).send({ error: 'Request not found' });
    const allowedFrom = to === 'WITHDRAWN' ? ['APPROVED'] : ['REQUESTED'];
    if (!allowedFrom.includes(share.status)) return reply.status(409).send({ error: `This request is already ${share.status.toLowerCase()}` });

    const updated = await prisma.historyShare.update({
      where: { id: share.id },
      data: to === 'APPROVED' ? { status: 'APPROVED', approvedAt: new Date(), approvalMethod: 'PORTAL' } : { status: to, endedAt: new Date() },
    });
    if (to === 'APPROVED') {
      await approvedSideEffects(updated, { actorUserId: patientAccountId, actorRole: 'PATIENT', patientId: null }, log);
    } else {
      await recordAudit({ entity: 'HistoryShare', recordId: share.id, clinicId: share.clinicId, action: 'UPDATE', actorUserId: patientAccountId, actorRole: 'PATIENT', metadata: { status: to } });
    }
    return { success: true, share: updated };
  };

  fastify.post('/patient-portal/history-sharing/:id/approve', { preHandler: [authenticatePatient] }, patientDecision('APPROVED'));
  fastify.post('/patient-portal/history-sharing/:id/decline', { preHandler: [authenticatePatient] }, patientDecision('DECLINED'));
  fastify.post('/patient-portal/history-sharing/:id/withdraw', { preHandler: [authenticatePatient] }, patientDecision('WITHDRAWN'));
}

// Audit, a security notice to the patient, and (if they approved remotely) word to the clinician who asked.
async function approvedSideEffects(
  share: { id: string; clinicId: string; patientAccountId: string; requestedByUserId: string; approvalMethod: string | null },
  actor: { actorUserId: string; actorRole: string; patientId: string | null },
  log: (message: string) => void
) {
  await recordAudit({
    entity: 'HistoryShare', recordId: share.id, clinicId: share.clinicId, action: 'UPDATE',
    actorUserId: actor.actorUserId, actorRole: actor.actorRole, metadata: { status: 'APPROVED', method: share.approvalMethod, ...(actor.patientId ? { patientId: actor.patientId } : {}) },
  });

  const clinic = await prisma.clinic.findUnique({ where: { id: share.clinicId }, select: { name: true } });
  const how = share.approvalMethod === 'PORTAL' ? 'from your Patient Portal' : share.approvalMethod === 'PIN' ? 'with your password' : 'with the code we emailed you';
  await notifyPatient({
    type: 'HISTORY_SHARING_APPROVED',
    patientAccountId: share.patientAccountId,
    clinicId: share.clinicId,
    title: `${clinic?.name ?? 'A facility'} can now see your history`,
    body: `You approved ${clinic?.name ?? 'a facility'} seeing your records from other facilities ${how}. You can stop sharing at any time from the Access page.${share.approvalMethod === 'PORTAL' ? '' : ' If this was not you, stop sharing there and change your password.'}`,
    link: '/patient-portal/access',
    emailSummary: 'You approved a facility seeing your health records from other facilities. If this was not you, sign in, stop sharing from the Access page and change your password.',
    log,
  });

  if (share.approvalMethod === 'PORTAL') {
    const patient = await prisma.patient.findFirst({ where: { patientAccountId: share.patientAccountId, clinicId: share.clinicId, deletedAt: null }, select: { id: true, name: true } });
    await notifyStaff({
      type: 'HISTORY_ACCESS_APPROVED',
      clinicId: share.clinicId,
      title: `History shared: ${patient?.name ?? 'a patient'}`,
      body: `${patient?.name ?? 'The patient'} approved your request to see their records from other facilities.`,
      link: patient ? `/patients/view?id=${patient.id}` : '/patients',
      emailSummary: 'A patient approved your request to see their history.',
      userIds: [share.requestedByUserId],
      log,
    });
  }
}
