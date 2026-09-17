import { FastifyInstance } from 'fastify';
import { prisma, isUniqueConstraintError } from '../lib/prisma';
import { authenticate, resolveClinicScope, assertClinicMatch, getAuthUser } from '../middleware/auth.middleware';
import bcrypt from 'bcrypt';
import { requireRole } from '../middleware/rbac.middleware';
import { recordAudit } from '../lib/audit';

// ADMIN accounts may never mint a SUPER_ADMIN - only SUPER_ADMIN can (and doesn't use this route today).
const ADMIN_ASSIGNABLE_ROLES = ['ADMIN', 'DOCTOR', 'PHARMACIST', 'NURSE', 'STAFF'];

export async function userRoutes(fastify: FastifyInstance) {

  // Get all users in clinic
  fastify.get('/users/:clinicId', { preHandler: [authenticate] }, async (request, reply) => {
    const { clinicId: requestedClinicId } = request.params as any;
    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;

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
    const { email, password, name, role, clinicId: requestedClinicId } = request.body as any;

    if (!ADMIN_ASSIGNABLE_ROLES.includes(role)) {
      return reply.status(400).send({ error: 'Invalid role for this account' });
    }

    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;

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

      const authUser = getAuthUser(request);
      await recordAudit({
        entity: 'User', recordId: user.id, clinicId,
        action: 'CREATE', actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { createdRole: role },
      });

      return { success: true, user };
    } catch (error: any) {
      if (isUniqueConstraintError(error)) {
        return reply.status(409).send({ error: 'An account with this email already exists' });
      }
      return reply.status(400).send({ error: error.message });
    }
  });

  // Deactivate user (ADMIN only)
  fastify.patch('/users/:id/deactivate', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const { id } = request.params as any;

    try {
      const existing = await prisma.user.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ error: 'User not found' });
      }
      if (existing.role === 'SUPER_ADMIN') {
        return reply.status(403).send({ error: 'Cannot deactivate a super admin account' });
      }
      if (!assertClinicMatch(request, reply, existing.clinicId)) return;

      const user = await prisma.user.update({
        where: { id },
        data: { isActive: false }
      });

      const authUser = getAuthUser(request);
      await recordAudit({
        entity: 'User', recordId: user.id, clinicId: user.clinicId,
        action: 'DEACTIVATE', actorUserId: authUser.userId, actorRole: authUser.role,
      });

      return { success: true, user };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });
}