import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate, assertClinicMatch, getAuthUser } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { recordAudit } from '../lib/audit';
import { createPortalAccountForPatient, isValidEmail, sendPasswordLink } from '../lib/portal-invite';

// Front desk registers and verifies patients at reception, so they may manage
// a patient's portal account alongside clinical staff.
const PORTAL_STAFF_ROLES = ['NURSE', 'DOCTOR', 'ADMIN', 'STAFF'] as const;

export async function patientAccountRoutes(fastify: FastifyInstance) {
  // Create a patient's portable portal account - staff-only, never a public
  // endpoint (a public "register as any patient" endpoint would let anyone
  // impersonate anyone). A patient may hold exactly one account; if the
  // phone number already has one, staff should use the cross-facility
  // linking flow instead of creating a duplicate identity.
  fastify.post(
    '/patients/:patientId/portal-account',
    { preHandler: [requireRole(...PORTAL_STAFF_ROLES)] },
    async (request, reply) => {
      const { patientId } = request.params as any;
      const { phone, email } = request.body as any;

      if (!phone || !email) {
        return reply.status(400).send({ error: 'Phone and email are required' });
      }
      if (!isValidEmail(email)) {
        return reply.status(400).send({ error: 'Enter a valid email address' });
      }

      const patient = await prisma.patient.findUnique({ where: { id: patientId }, include: { clinic: true } });
      if (!patient) return reply.status(404).send({ error: 'Patient not found' });
      if (!assertClinicMatch(request, reply, patient.clinicId)) return;

      const authUser = getAuthUser(request);

      try {
        const outcome = await createPortalAccountForPatient({
          patient,
          clinicName: patient.clinic.name,
          phone,
          email,
          actor: { userId: authUser.userId, role: authUser.role },
          log: (message) => fastify.log.info(message),
        });

        switch (outcome.status) {
          case 'patient_has_account':
            return reply.status(409).send({ error: 'This patient already has a portal account' });
          case 'phone_in_use':
            return reply.status(409).send({ error: `This phone number already has a portal account (Patient ID: ${outcome.portableId}). Use the link-existing-patient flow instead of creating a new one.` });
          case 'email_in_use':
            return reply.status(409).send({ error: 'This email is already used by another patient account' });
          case 'created':
            return {
              success: true,
              portableId: outcome.portableId,
              ...(process.env.NODE_ENV !== 'production' ? { devSetPasswordUrl: outcome.setPasswordUrl } : {}),
            };
        }
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
    }
  );

  // Whether a patient already has a portal account, and whether the patient
  // has activated it yet - lets staff UI show the right action (create,
  // resend the invitation, or nothing) without guessing.
  fastify.get('/patients/:patientId/portal-account', { preHandler: [authenticate] }, async (request, reply) => {
    const { patientId } = request.params as any;

    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      select: {
        clinicId: true,
        patientAccountId: true,
        patientAccount: { select: { portableId: true, status: true, mustResetPassword: true } },
      },
    });
    if (!patient) return reply.status(404).send({ error: 'Patient not found' });
    if (!assertClinicMatch(request, reply, patient.clinicId)) return;

    const account = patient.patientAccount
      ? { portableId: patient.patientAccount.portableId, status: patient.patientAccount.status, activated: !patient.patientAccount.mustResetPassword }
      : null;
    return { success: true, account };
  });

  // Re-send the set-up email to a patient who hasn't activated their account
  // (lost or expired email, or a mistyped address that staff have corrected).
  // Once activated, the patient uses "Forgot password" themselves instead.
  fastify.post(
    '/patients/:patientId/portal-account/resend',
    { preHandler: [requireRole(...PORTAL_STAFF_ROLES)] },
    async (request, reply) => {
      const { patientId } = request.params as any;

      const patient = await prisma.patient.findUnique({
        where: { id: patientId },
        include: { clinic: { select: { name: true } }, patientAccount: true },
      });
      if (!patient) return reply.status(404).send({ error: 'Patient not found' });
      if (!assertClinicMatch(request, reply, patient.clinicId)) return;
      if (!patient.patientAccount) return reply.status(404).send({ error: 'This patient has no portal account' });
      if (!patient.patientAccount.mustResetPassword) {
        return reply.status(409).send({ error: 'This patient has already activated their account. They can use "Forgot password" to reset it.' });
      }

      const authUser = getAuthUser(request);
      const { setPasswordUrl } = await sendPasswordLink({
        patientAccountId: patient.patientAccount.id,
        email: patient.patientAccount.email,
        patientName: patient.name,
        clinicName: patient.clinic.name,
        portableId: patient.patientAccount.portableId,
        kind: 'invitation',
        log: (message) => fastify.log.info(message),
      });

      await recordAudit({
        entity: 'PatientAccount', recordId: patient.patientAccount.id, clinicId: patient.clinicId,
        action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { event: 'INVITATION_RESENT' },
      });

      return {
        success: true,
        ...(process.env.NODE_ENV !== 'production' ? { devSetPasswordUrl: setPasswordUrl } : {}),
      };
    }
  );
}
