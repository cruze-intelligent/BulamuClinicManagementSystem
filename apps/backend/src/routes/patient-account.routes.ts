import { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { prisma, isUniqueConstraintError } from '../lib/prisma';
import { authenticate, assertClinicMatch, getAuthUser } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { recordAudit } from '../lib/audit';
import { generateToken, hashToken } from '../lib/crypto';
import { generatePortableId, normalizePhoneKey, findAccountByPhone } from '../lib/patient-account';
import { sendMail, patientPortalAccountCreatedEmail } from '../lib/mailer';

const SET_PASSWORD_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function patientAccountRoutes(fastify: FastifyInstance) {
  // Create a patient's portable portal account - staff-only, never a public
  // endpoint (a public "register as any patient" endpoint would let anyone
  // impersonate anyone). A patient may hold exactly one account; if the
  // phone number already has one, staff should use the cross-facility
  // linking flow instead of creating a duplicate identity.
  fastify.post(
    '/patients/:patientId/portal-account',
    { preHandler: [requireRole('NURSE', 'DOCTOR', 'ADMIN')] },
    async (request, reply) => {
      const { patientId } = request.params as any;
      const { phone, email } = request.body as any;

      if (!phone || !email) {
        return reply.status(400).send({ error: 'Phone and email are required' });
      }

      const patient = await prisma.patient.findUnique({ where: { id: patientId }, include: { clinic: true } });
      if (!patient) return reply.status(404).send({ error: 'Patient not found' });
      if (!assertClinicMatch(request, reply, patient.clinicId)) return;

      if (patient.patientAccountId) {
        return reply.status(409).send({ error: 'This patient already has a portal account' });
      }

      const duplicate = await findAccountByPhone(phone);
      if (duplicate) {
        return reply.status(409).send({ error: `This phone number already has a portal account (Patient ID: ${duplicate.portableId}). Use the link-existing-patient flow instead of creating a new one.` });
      }

      const authUser = getAuthUser(request);

      try {
        const portableId = await generatePortableId();
        // A random, never-communicated placeholder - the account is unusable
        // until the patient sets their own password via the emailed link.
        const placeholderPassword = await bcrypt.hash(generateToken(), 10);

        const account = await prisma.patientAccount.create({
          data: {
            portableId,
            phone,
            phoneKey: normalizePhoneKey(phone),
            email,
            password: placeholderPassword,
            mustResetPassword: true,
            createdByClinicId: patient.clinicId,
            createdByUserId: authUser.userId,
          },
        });

        await prisma.patient.update({ where: { id: patient.id }, data: { patientAccountId: account.id } });

        const rawToken = generateToken();
        await prisma.patientPasswordResetToken.create({
          data: {
            patientAccountId: account.id,
            tokenHash: hashToken(rawToken),
            expiresAt: new Date(Date.now() + SET_PASSWORD_TOKEN_TTL_MS),
          },
        });

        await recordAudit({
          entity: 'PatientAccount', recordId: account.id, clinicId: patient.clinicId,
          action: 'CREATE', actorUserId: authUser.userId, actorRole: authUser.role,
          metadata: { patientId: patient.id, portableId },
        });

        const setPasswordUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/patient-portal/set-password?token=${rawToken}`;
        const mailResult = await sendMail({
          to: email,
          subject: 'Your Bulamu patient account',
          html: patientPortalAccountCreatedEmail(patient.name, portableId, patient.clinic.name, setPasswordUrl),
        });
        if (!mailResult.sent) {
          fastify.log.info(`Patient portal account created for ${email}: ${setPasswordUrl}`);
        }

        return {
          success: true,
          portableId,
          ...(process.env.NODE_ENV !== 'production' ? { devSetPasswordUrl: setPasswordUrl } : {}),
        };
      } catch (error: any) {
        if (isUniqueConstraintError(error)) {
          return reply.status(409).send({ error: 'This email is already used by another patient account' });
        }
        return reply.status(400).send({ error: error.message });
      }
    }
  );

  // Whether a patient already has a portal account - lets staff UI show the
  // right action (create vs. already linked) without guessing.
  fastify.get('/patients/:patientId/portal-account', { preHandler: [authenticate] }, async (request, reply) => {
    const { patientId } = request.params as any;

    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      select: { clinicId: true, patientAccountId: true, patientAccount: { select: { portableId: true, status: true } } },
    });
    if (!patient) return reply.status(404).send({ error: 'Patient not found' });
    if (!assertClinicMatch(request, reply, patient.clinicId)) return;

    return { success: true, account: patient.patientAccount };
  });
}
