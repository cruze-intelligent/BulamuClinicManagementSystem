import { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma';
import { getAuthUser } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { recordAudit } from '../lib/audit';
import { generateOtp } from '../lib/patient-account';
import { hashToken } from '../lib/crypto';
import { sendMail, patientAccessOtpEmail } from '../lib/mailer';
import { notifyPatient } from '../lib/notifications';

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

// The genuinely abuse-prone surfaces this flow introduces: guessing a
// portable ID (enumeration) and brute-forcing an OTP/password. Tighter than
// the app-wide rate-limit default registered in app.ts.
const LOOKUP_RATE_LIMIT = { max: 10, timeWindow: '15 minutes' };
const LINK_RATE_LIMIT = { max: 8, timeWindow: '15 minutes' };

export async function patientAccessRoutes(fastify: FastifyInstance) {
  // Step 1 of the cross-facility linking flow: staff enter a portable ID and
  // get back only enough to visually confirm it's the right person - never
  // clinical data, never contact details beyond what staff already typed.
  fastify.post(
    '/patients/lookup-account',
    { preHandler: [requireRole('NURSE', 'DOCTOR', 'ADMIN', 'STAFF')], config: { rateLimit: LOOKUP_RATE_LIMIT } },
    async (request, reply) => {
      const { portableId } = request.body as any;
      const authUser = getAuthUser(request);
      if (!portableId) return reply.status(400).send({ error: 'portableId is required' });

      const account = await prisma.patientAccount.findUnique({
        where: { portableId },
        select: {
          id: true,
          status: true,
          patients: { take: 1, orderBy: { createdAt: 'asc' }, select: { name: true, dateOfBirth: true, sex: true } },
        },
      });
      if (!account || account.status !== 'ACTIVE') {
        return reply.status(404).send({ error: 'No active account found for that Patient ID' });
      }

      const existingLink = await prisma.patient.findFirst({
        where: { patientAccountId: account.id, clinicId: authUser.clinicId, deletedAt: null },
        select: { id: true },
      });

      const identity = account.patients[0];
      return {
        success: true,
        portableId,
        name: identity?.name ?? null,
        dateOfBirth: identity?.dateOfBirth ?? null,
        sex: identity?.sex ?? null,
        alreadyLinkedPatientId: existingLink?.id ?? null,
      };
    }
  );

  // Step 2 (OTP method): emails a one-time code the patient reads off their
  // own phone/email, out of band from the staff device doing the lookup.
  fastify.post(
    '/patients/link-account/otp',
    { preHandler: [requireRole('NURSE', 'DOCTOR', 'ADMIN', 'STAFF')], config: { rateLimit: LOOKUP_RATE_LIMIT } },
    async (request, reply) => {
      const { portableId } = request.body as any;
      const authUser = getAuthUser(request);
      if (!portableId) return reply.status(400).send({ error: 'portableId is required' });

      const account = await prisma.patientAccount.findUnique({ where: { portableId } });
      if (!account || account.status !== 'ACTIVE') {
        return reply.status(404).send({ error: 'No active account found for that Patient ID' });
      }

      const clinic = await prisma.clinic.findUnique({ where: { id: authUser.clinicId }, select: { name: true } });

      const code = generateOtp();
      // Retention: expired and used codes for this patient/facility pair are
      // removed when a new one is issued (see DATA_RETENTION.md).
      await prisma.patientAccessOtp.deleteMany({
        where: {
          patientAccountId: account.id,
          clinicId: authUser.clinicId,
          OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { not: null } }],
        },
      });
      await prisma.patientAccessOtp.create({
        data: {
          patientAccountId: account.id,
          clinicId: authUser.clinicId,
          codeHash: hashToken(code),
          expiresAt: new Date(Date.now() + OTP_TTL_MS),
        },
      });

      const mailResult = await sendMail({
        to: account.email,
        subject: 'Your Bulamu verification code',
        html: patientAccessOtpEmail(clinic?.name || 'A Bulamu facility', code),
      });
      if (!mailResult.sent) {
        fastify.log.info(`Patient access OTP for ${account.email}: ${code}`);
      }

      return {
        success: true,
        message: 'A verification code was sent to the patient\'s email',
        ...(process.env.NODE_ENV !== 'production' ? { devOtp: code } : {}),
      };
    }
  );

  // Step 3: completes the link using either the patient's own password
  // ("PIN" - entered on-device while they're physically present) or the
  // emailed OTP. Creates this facility's own Patient row linked to the
  // account (if one doesn't already exist) and the PatientAccessGrant that
  // makes this facility's data visible in the patient's own aggregated view.
  fastify.post(
    '/patients/link-account',
    { preHandler: [requireRole('NURSE', 'DOCTOR', 'ADMIN', 'STAFF')], config: { rateLimit: LINK_RATE_LIMIT } },
    async (request, reply) => {
      const { portableId, method, password, otp } = request.body as any;
      const authUser = getAuthUser(request);

      if (!portableId || !method) {
        return reply.status(400).send({ error: 'portableId and method are required' });
      }
      if (method !== 'PIN' && method !== 'OTP') {
        return reply.status(400).send({ error: 'method must be PIN or OTP' });
      }

      const account = await prisma.patientAccount.findUnique({
        where: { portableId },
        include: { patients: { take: 1, orderBy: { createdAt: 'asc' } } },
      });
      if (!account || account.status !== 'ACTIVE') {
        return reply.status(404).send({ error: 'No active account found for that Patient ID' });
      }

      if (method === 'PIN') {
        if (!password) return reply.status(400).send({ error: 'password is required for the PIN method' });
        const valid = await bcrypt.compare(password, account.password);
        if (!valid) return reply.status(401).send({ error: 'Incorrect password' });
      } else {
        if (!otp) return reply.status(400).send({ error: 'otp is required for the OTP method' });
        const otpRow = await prisma.patientAccessOtp.findFirst({
          where: { patientAccountId: account.id, clinicId: authUser.clinicId, usedAt: null },
          orderBy: { createdAt: 'desc' },
        });
        if (!otpRow || otpRow.expiresAt < new Date() || otpRow.codeHash !== hashToken(otp)) {
          return reply.status(401).send({ error: 'Incorrect or expired verification code' });
        }
        await prisma.patientAccessOtp.update({ where: { id: otpRow.id }, data: { usedAt: new Date() } });
      }

      const existingGrant = await prisma.patientAccessGrant.findFirst({
        where: { patientAccountId: account.id, clinicId: authUser.clinicId, revokedAt: null },
      });
      const existingPatient = await prisma.patient.findFirst({
        where: { patientAccountId: account.id, clinicId: authUser.clinicId, deletedAt: null },
      });
      if (existingGrant && existingPatient) {
        return reply.status(409).send({ error: 'This facility already has access to this patient\'s account' });
      }

      const identity = account.patients[0];
      const patient = existingPatient ?? await prisma.patient.create({
        data: {
          name: identity?.name ?? 'Unnamed patient',
          phone: account.phone,
          sex: identity?.sex ?? null,
          dateOfBirth: identity?.dateOfBirth ?? null,
          clinicId: authUser.clinicId,
          patientAccountId: account.id,
        },
      });

      const grant = existingGrant ?? await prisma.patientAccessGrant.create({
        data: {
          patientAccountId: account.id,
          clinicId: authUser.clinicId,
          method,
          grantedByUserId: authUser.userId,
        },
      });

      await recordAudit({
        entity: 'PatientAccessGrant', recordId: grant.id, clinicId: authUser.clinicId,
        action: 'CREATE', actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { patientAccountId: account.id, method, patientId: patient.id },
      });

      // A security notice: the patient should always hear when another
      // facility is given access to their records, so they can spot (and
      // revoke) one they didn't expect.
      if (!existingGrant) {
        const grantedClinic = await prisma.clinic.findUnique({ where: { id: authUser.clinicId }, select: { name: true } });
        await notifyPatient({
          type: 'RECORD_ACCESS_GRANTED',
          patientAccountId: account.id,
          clinicId: authUser.clinicId,
          title: 'A new facility can now see your records',
          body: `${grantedClinic?.name ?? 'A facility'} was given access to your records after confirming your identity with your ${method === 'PIN' ? 'password' : 'email code'}. If this was not you, revoke the access from the Access page and change your password.`,
          link: '/patient-portal/access',
          emailSummary: 'A facility was given access to your Bulamu records. If you did not expect this, sign in to review it and revoke the access.',
          log: (message) => fastify.log.warn(message),
        });
      }

      return { success: true, patient };
    }
  );
}
