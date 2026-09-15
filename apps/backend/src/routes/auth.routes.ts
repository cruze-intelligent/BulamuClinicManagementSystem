import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcrypt';
import { generateToken, hashToken } from '../lib/crypto';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const MIN_PASSWORD_LENGTH = 10;

export async function authRoutes(fastify: FastifyInstance) {

  // Login
  fastify.post('/auth/login', async (request, reply) => {
    const { email, password } = request.body as any;

    try {
      // Find user
      const user = await prisma.user.findUnique({
        where: { email },
        include: { clinic: true }
      });

      if (!user || !user.isActive) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      // Verify password
      const validPassword = await bcrypt.compare(password, user.password);
      
      if (!validPassword) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

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
        const rawToken = generateToken();
        await prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: hashToken(rawToken),
            expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
          },
        });

        const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/reset-password?token=${rawToken}`;
        // No email/SMS provider is wired up yet (see DEPLOYMENT.md) - the
        // reset link is logged so an admin can relay it out-of-band until
        // one is configured. Never expose the raw token in the response body.
        fastify.log.info(`Password reset requested for ${email}: ${resetUrl}`);

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