import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcrypt';
import { generateToken, hashToken } from '../lib/crypto';
import { sendMail, passwordResetEmail, facilityPendingApprovalEmail, registrationReceivedEmail, ADMIN_NOTIFY_EMAIL } from '../lib/mailer';
import { generateFacilityCode, normalizePhoneKey, findDuplicateFacility, duplicateFacilityMessage } from '../lib/facility';
import { isUniqueConstraintError } from '../lib/prisma';
import { recordLoginEvent } from '../lib/usage-tracking';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const MIN_PASSWORD_LENGTH = 10;

export async function authRoutes(fastify: FastifyInstance) {

  // Self-service facility registration. Always creates the account as a
  // pending ADMIN awaiting super-admin approval - never issues a token here,
  // and never trusts a caller-supplied role (a public endpoint that could
  // mint any role, including SUPER_ADMIN, would be a privilege-escalation hole).
  fastify.post('/auth/register', async (request, reply) => {
    const {
      facilityName, facilityType, phone, address, district, subCounty, parish,
      adminName, adminEmail, adminPassword,
    } = request.body as any;

    if (!facilityName || !phone || !address || !adminName || !adminEmail || !adminPassword) {
      return reply.status(400).send({ error: 'Missing required registration fields' });
    }
    if (adminPassword.length < MIN_PASSWORD_LENGTH) {
      return reply.status(400).send({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    try {
      // The email check, the one-trial-per-facility check, and the (CPU-heavy
      // on small hosts) password hash are independent - run them together
      // rather than paying for each round trip in sequence.
      const [existing, duplicate, hashedPassword] = await Promise.all([
        prisma.user.findUnique({ where: { email: adminEmail } }),
        findDuplicateFacility(phone),
        bcrypt.hash(adminPassword, 10),
      ]);
      if (existing) {
        return reply.status(409).send({ error: 'An account with this email already exists' });
      }
      // One free trial per facility: reject a duplicate registration for a
      // phone number that already has a pending or approved facility on file.
      if (duplicate) {
        return reply.status(409).send({ error: duplicateFacilityMessage(duplicate) });
      }

      const facilityCode = await generateFacilityCode();
      const clinic = await prisma.clinic.create({
        data: {
          facilityCode,
          name: facilityName,
          facilityType: facilityType || 'CLINIC',
          phone, phoneKey: normalizePhoneKey(phone), address,
          district: district || null,
          subCounty: subCounty || null,
          parish: parish || null,
          isActive: false,
          registrationStatus: 'PENDING',
          users: { create: { email: adminEmail, password: hashedPassword, name: adminName, role: 'ADMIN', isActive: false } },
        },
      });

      fastify.log.info(`New facility registration pending approval: ${clinic.name} (${clinic.facilityCode})`);

      // Email is a best-effort side channel: the registration is already
      // saved, so never make the registrant wait on (or fail because of) an
      // SMTP round trip. sendMail never throws; failures are only logged.
      const consoleUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/super-admin`;
      void Promise.all([
        sendMail({
          to: ADMIN_NOTIFY_EMAIL,
          subject: `New facility awaiting approval - ${clinic.name}`,
          html: facilityPendingApprovalEmail(clinic.name, clinic.facilityCode, consoleUrl),
        }),
        sendMail({
          to: adminEmail,
          subject: `We received your Bulamu registration - ${clinic.name}`,
          html: registrationReceivedEmail(adminName, clinic.name, clinic.facilityCode),
        }),
      ]).then(([adminNotice, registrantNotice]) => {
        if (!adminNotice.sent) fastify.log.warn(`Registration admin notice not sent: ${adminNotice.reason}`);
        if (!registrantNotice.sent) fastify.log.warn(`Registration confirmation to ${adminEmail} not sent: ${registrantNotice.reason}`);
      }).catch((error) => fastify.log.error(error, 'Registration emails failed'));

      return {
        success: true,
        message: 'Registration submitted. A Bulamu administrator will review and approve your facility shortly.',
        facilityCode: clinic.facilityCode,
      };
    } catch (error: any) {
      if (isUniqueConstraintError(error)) {
        return reply.status(409).send({ error: 'An account with this email already exists' });
      }
      return reply.status(400).send({ error: error.message });
    }
  });

  // Login
  fastify.post('/auth/login', async (request, reply) => {
    const { email, password } = request.body as any;

    try {
      // Find user
      const user = await prisma.user.findUnique({
        where: { email },
        include: { clinic: true }
      });

      if (!user) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }
      const who = { id: user.id, clinicId: user.clinicId };

      // Verify password first - only reveal account/clinic status to someone
      // who already proved they know the password, so this endpoint can't be
      // used to probe whether an email is registered/pending/suspended.
      const validPassword = await bcrypt.compare(password, user.password);

      if (!validPassword) {
        recordLoginEvent(who, 'WRONG_PASSWORD');
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      if (
        user.clinic.registrationStatus === 'PENDING' || user.clinic.registrationStatus === 'REJECTED' ||
        !user.clinic.isActive || !user.isActive
      ) {
        recordLoginEvent(who, 'BLOCKED');
      }

      if (user.clinic.registrationStatus === 'PENDING') {
        return reply.status(403).send({ error: 'Your facility registration is pending approval', reason: 'PENDING_APPROVAL' });
      }
      if (user.clinic.registrationStatus === 'REJECTED') {
        return reply.status(403).send({ error: 'Your facility registration was not approved', reason: 'REJECTED', rejectionReason: user.clinic.rejectionReason || undefined });
      }
      if (!user.clinic.isActive) {
        return reply.status(403).send({ error: 'Your facility account is suspended', reason: 'SUSPENDED' });
      }
      if (!user.isActive) {
        return reply.status(403).send({ error: 'Your account has been deactivated', reason: 'ACCOUNT_DEACTIVATED' });
      }

      recordLoginEvent(who, 'SUCCESS');

      // Generate JWT token (12h expiry - covers a full offline field shift)
       const token = fastify.jwt.sign(
        {
            userId: user.id,
            clinicId: user.clinicId,
            role: user.role
        },
        { expiresIn: '12h' }
        );

        // Return user data (no password) + token
        const { password: _, ...userWithoutPassword } = user;

        return { 
        success: true, 
        token,
        user: userWithoutPassword 
        };
        
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // Request a password reset. Always responds success (whether or not the
  // email matches an account) so this endpoint can't be used to enumerate
  // registered emails.
  fastify.post('/auth/forgot-password', async (request, reply) => {
    const { email } = request.body as any;

    try {
      const user = await prisma.user.findUnique({ where: { email } });

      if (user && user.isActive) {
        // Retention: drop this user's expired and already-used reset tokens
        // now that a new one is being issued (see DATA_RETENTION.md).
        await prisma.passwordResetToken.deleteMany({
          where: { userId: user.id, OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { not: null } }] },
        });
        const rawToken = generateToken();
        await prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: hashToken(rawToken),
            expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
          },
        });

        const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/reset-password?token=${rawToken}`;
        const mailResult = await sendMail({
          to: email,
          subject: 'Reset your Bulamu password',
          html: passwordResetEmail(resetUrl),
        });
        // SMTP isn't configured everywhere (e.g. local dev) - log the link so
        // it can be relayed out-of-band until it is. Never expose the raw
        // token in the response body once email delivery is actually live.
        if (!mailResult.sent) {
          fastify.log.info(`Password reset requested for ${email}: ${resetUrl}`);
        }

        if (process.env.NODE_ENV !== 'production') {
          return { success: true, devResetUrl: resetUrl };
        }
      }

      return { success: true };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  fastify.post('/auth/reset-password', async (request, reply) => {
    const { token, password } = request.body as any;

    if (!token || !password || password.length < MIN_PASSWORD_LENGTH) {
      return reply.status(400).send({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    try {
      const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });

      if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
        return reply.status(400).send({ error: 'Reset link is invalid or has expired' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      await prisma.$transaction([
        prisma.user.update({ where: { id: resetToken.userId }, data: { password: hashedPassword } }),
        prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } }),
      ]);

      return { success: true };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });
}