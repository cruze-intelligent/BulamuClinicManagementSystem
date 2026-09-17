import { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma';
import { hashToken } from '../lib/crypto';
import { normalizePhoneKey } from '../lib/patient-account';

const MIN_PASSWORD_LENGTH = 10;

// These are the genuinely abuse-prone new surfaces this feature introduces
// (credential guessing, account enumeration) - tighter than the app-wide
// rate-limit default registered in app.ts.
const LOGIN_RATE_LIMIT = { max: 8, timeWindow: '15 minutes' };
const SET_PASSWORD_RATE_LIMIT = { max: 8, timeWindow: '15 minutes' };

export async function patientAuthRoutes(fastify: FastifyInstance) {
  // Login accepts a patient's portable ID, email, or phone number as the
  // identifier - whichever they have on hand - plus their password.
  fastify.post('/patient-auth/login', { config: { rateLimit: LOGIN_RATE_LIMIT } }, async (request, reply) => {
    const { identifier, password } = request.body as any;
    if (!identifier || !password) {
      return reply.status(400).send({ error: 'Identifier and password are required' });
    }

    try {
      const phoneKey = normalizePhoneKey(identifier);
      const account = await prisma.patientAccount.findFirst({
        where: {
          OR: [
            { portableId: identifier },
            { email: identifier },
            ...(phoneKey ? [{ phoneKey }] : []),
          ],
        },
      });

      if (!account) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      const validPassword = await bcrypt.compare(password, account.password);
      if (!validPassword) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      if (account.status !== 'ACTIVE') {
        return reply.status(403).send({ error: 'This account is suspended' });
      }

      const token = fastify.jwt.sign(
        { kind: 'patient', patientAccountId: account.id },
        { expiresIn: '12h' }
      );

      return {
        success: true,
        token,
        mustResetPassword: account.mustResetPassword,
        patient: { portableId: account.portableId, email: account.email, phone: account.phone },
      };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // Sets the account's password from the token emailed on account creation
  // (or a future forgot-password flow) - mirrors POST /auth/reset-password
  // for staff. Always clears mustResetPassword so the portal knows the
  // placeholder password staff never saw has been replaced.
  fastify.post('/patient-auth/set-password', { config: { rateLimit: SET_PASSWORD_RATE_LIMIT } }, async (request, reply) => {
    const { token, password } = request.body as any;

    if (!token || !password || password.length < MIN_PASSWORD_LENGTH) {
      return reply.status(400).send({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    try {
      const resetToken = await prisma.patientPasswordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });

      if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
        return reply.status(400).send({ error: 'This link is invalid or has expired' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      await prisma.$transaction([
        prisma.patientAccount.update({
          where: { id: resetToken.patientAccountId },
          data: { password: hashedPassword, mustResetPassword: false },
        }),
        prisma.patientPasswordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } }),
      ]);

      return { success: true };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });
}
