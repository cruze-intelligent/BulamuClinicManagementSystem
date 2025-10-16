import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth.middleware';
import bcrypt from 'bcrypt';
import { requireRole } from '../middleware/rbac.middleware';

export async function userRoutes(fastify: FastifyInstance) {
  
  // Get all users in clinic
  fastify.get('/users/:clinicId', { preHandler: [authenticate] }, async (request, reply) => {
    const { clinicId } = request.params as any;

    try {
      const users = await prisma.user.findMany({
        where: { clinicId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' }
      });

      return { success: true, users };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // Add user to clinic (ADMIN only)
  fastify.post('/users', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const { email, password, name, role, clinicId } = request.body as any;

    try {
      const hashedPassword = await bcrypt.hash(password, 10);

      const user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          name,
          role,
          clinicId
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true
        }
      });

      return { success: true, user };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });

  // Deactivate user (ADMIN only)
  fastify.patch('/users/:id/deactivate', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const { id } = request.params as any;

    try {
      const user = await prisma.user.update({
        where: { id },
        data: { isActive: false }
      });

      return { success: true, user };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });
}