import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma, isUniqueConstraintError } from '../lib/prisma';
import { authenticate, resolveClinicScope, assertClinicMatch, getAuthUser } from '../middleware/auth.middleware';
import bcrypt from 'bcrypt';
import { requireRole } from '../middleware/rbac.middleware';
import { recordAudit } from '../lib/audit';
import { isValidEmail } from '../lib/portal-invite';

// ADMIN accounts may never mint a SUPER_ADMIN - only SUPER_ADMIN can (and doesn't use this route today).
const ADMIN_ASSIGNABLE_ROLES = ['ADMIN', 'DOCTOR', 'PHARMACIST', 'NURSE', 'STAFF', 'LAB_TECH'];

export async function userRoutes(fastify: FastifyInstance) {

  // Get all users in clinic
  fastify.get('/users/:clinicId', { preHandler: [authenticate] }, async (request, reply) => {
    const { clinicId: requestedClinicId } = request.params as any;
    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;

    // Administrators also see when each person last signed in (to spot
    // accounts nobody uses); other roles only need the list itself.
    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(getAuthUser(request).role);

    try {
      const users = await prisma.user.findMany({
        where: { clinicId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
          lastLoginAt: isAdmin,
        },
        orderBy: { createdAt: 'desc' }
      });

      return { success: true, users };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // The signed-in user finished or skipped the walkthrough: it will not open by
  // itself again, on any device (it can still be replayed from Help & FAQ).
  fastify.post('/users/me/tour-completed', { preHandler: [authenticate] }, async (request) => {
    const { userId } = getAuthUser(request);
    const user = await prisma.user.update({ where: { id: userId }, data: { tourCompletedAt: new Date() }, select: { tourCompletedAt: true } });
    return { success: true, tourCompletedAt: user.tourCompletedAt };
  });

  // Add user to clinic (ADMIN only)
  fastify.post('/users', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const { email, password, name, role, clinicId: requestedClinicId } = request.body as any;

    if (!ADMIN_ASSIGNABLE_ROLES.includes(role)) {
      return reply.status(400).send({ error: 'Invalid role for this account' });
    }
    if (typeof name !== 'string' || !name.trim()) return reply.status(400).send({ error: "Enter the staff member's name" });
    if (!isValidEmail(email)) return reply.status(400).send({ error: 'Enter a valid email address' });
    const problem = passwordProblem(password);
    if (problem) return reply.status(400).send({ error: problem });

    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;

    try {
      const hashedPassword = await bcrypt.hash(password, 10);

      const user = await prisma.user.create({
        data: {
          email: email.trim(),
          password: hashedPassword,
          name: name.trim(),
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

  // --- Managing a facility's staff (the facility's ADMIN) ----------------------
  // Every change is limited to the admin's own facility, never touches a
  // platform administrator, and can't leave the facility without an active
  // administrator (or lock the admin out of their own account).

  fastify.patch('/users/:id', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { name?: unknown; email?: unknown; role?: unknown };
    const authUser = getAuthUser(request);

    const target = await manageableUser(request, reply, id);
    if (!target) return;

    const data: { name?: string; email?: string; role?: AssignableRole } = {};
    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) return reply.status(400).send({ error: "Enter the staff member's name" });
      if (name !== target.name) data.name = name;
    }
    if (body.email !== undefined) {
      // Trimmed, not lower-cased: sign-in matches the address as stored.
      const email = typeof body.email === 'string' ? body.email.trim() : '';
      if (!isValidEmail(email)) return reply.status(400).send({ error: 'Enter a valid email address' });
      if (email !== target.email) data.email = email;
    }
    if (body.role !== undefined) {
      if (typeof body.role !== 'string' || !ADMIN_ASSIGNABLE_ROLES.includes(body.role)) {
        return reply.status(400).send({ error: 'Invalid role for this account' });
      }
      if (body.role !== target.role) {
        if (target.id === authUser.userId) {
          return reply.status(400).send({ error: "You can't change your own role. Another administrator can do it for you." });
        }
        if (target.role === 'ADMIN' && (await isLastActiveAdmin(target))) {
          return reply.status(400).send({ error: LAST_ADMIN });
        }
        data.role = body.role as AssignableRole;
      }
    }
    if (Object.keys(data).length === 0) return { success: true, user: publicUser(target) };

    try {
      const user = await prisma.user.update({ where: { id }, data, select: SAFE_USER });
      await recordAudit({
        entity: 'User', recordId: user.id, clinicId: target.clinicId,
        action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { fields: Object.keys(data), ...(data.role ? { fromRole: target.role, toRole: data.role } : {}) },
      });
      return { success: true, user };
    } catch (error: any) {
      if (isUniqueConstraintError(error)) return reply.status(409).send({ error: 'An account with this email already exists' });
      return reply.status(400).send({ error: error.message });
    }
  });

  // Signing in stops at once (the session check re-reads the account on every request).
  fastify.patch('/users/:id/deactivate', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const authUser = getAuthUser(request);
    const target = await manageableUser(request, reply, id);
    if (!target) return;
    if (target.id === authUser.userId) {
      return reply.status(400).send({ error: "You can't deactivate your own account." });
    }
    if (target.role === 'ADMIN' && (await isLastActiveAdmin(target))) {
      return reply.status(400).send({ error: LAST_ADMIN });
    }

    try {
      const user = await prisma.user.update({ where: { id }, data: { isActive: false }, select: SAFE_USER });
      await recordAudit({
        entity: 'User', recordId: user.id, clinicId: target.clinicId,
        action: 'DEACTIVATE', actorUserId: authUser.userId, actorRole: authUser.role,
      });
      return { success: true, user };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });

  fastify.patch('/users/:id/activate', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const authUser = getAuthUser(request);
    const target = await manageableUser(request, reply, id);
    if (!target) return;

    try {
      const user = await prisma.user.update({ where: { id }, data: { isActive: true }, select: SAFE_USER });
      await recordAudit({
        entity: 'User', recordId: user.id, clinicId: target.clinicId,
        action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { fields: ['isActive'], reactivated: true },
      });
      return { success: true, user };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });

  // For a staff member who can't use "Forgot your password?" (no access to
  // their email). Their existing sessions end; the admin passes on the new one.
  fastify.patch('/users/:id/password', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { password } = (request.body ?? {}) as { password?: unknown };
    const authUser = getAuthUser(request);
    const target = await manageableUser(request, reply, id);
    if (!target) return;
    if (target.id === authUser.userId) {
      return reply.status(400).send({ error: 'To change your own password, use "Forgot your password?" on the sign-in page.' });
    }
    const problem = passwordProblem(password);
    if (problem) return reply.status(400).send({ error: problem });

    try {
      await prisma.user.update({ where: { id }, data: { password: await bcrypt.hash(password as string, 10) } });
      await recordAudit({
        entity: 'User', recordId: id, clinicId: target.clinicId,
        action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { fields: ['password'] },
      });
      return { success: true };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });

  // Removes an account added by mistake. An account someone has worked under
  // stays (deactivated instead), so every record keeps saying who wrote it.
  fastify.delete('/users/:id', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const authUser = getAuthUser(request);
    const target = await manageableUser(request, reply, id);
    if (!target) return;
    if (target.id === authUser.userId) {
      return reply.status(400).send({ error: "You can't delete your own account." });
    }
    if (target.role === 'ADMIN' && (await isLastActiveAdmin(target))) {
      return reply.status(400).send({ error: LAST_ADMIN });
    }

    try {
      const work = await recordedWork(id);
      if (work.length > 0) {
        return reply.status(409).send({
          reason: 'HAS_RECORDS',
          error: `${target.name} has work recorded at this facility (${work.join(', ')}), so the account can't be deleted - the records must keep showing who did it. Deactivate it instead: they will no longer be able to sign in.`,
        });
      }

      await prisma.$transaction([
        prisma.passwordResetToken.deleteMany({ where: { userId: id } }),
        prisma.user.delete({ where: { id } }),
      ]);
      await recordAudit({
        entity: 'User', recordId: id, clinicId: target.clinicId,
        action: 'DELETE', actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { role: target.role },
      });
      return { success: true };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });
}

type AssignableRole = 'ADMIN' | 'DOCTOR' | 'PHARMACIST' | 'NURSE' | 'STAFF' | 'LAB_TECH';

const LAST_ADMIN = "This is the facility's only active administrator. Make someone else an administrator first.";

// Never the password hash.
const SAFE_USER = { id: true, email: true, name: true, role: true, isActive: true, createdAt: true, lastLoginAt: true } as const;

type ManagedUser = { id: string; name: string; email: string; role: string; isActive: boolean; clinicId: string; createdAt: Date; lastLoginAt: Date | null };

const publicUser = ({ id, email, name, role, isActive, createdAt, lastLoginAt }: ManagedUser) => ({ id, email, name, role, isActive, createdAt, lastLoginAt });

/** The account, if it is one this admin may manage; otherwise sends the refusal and returns null. */
async function manageableUser(request: FastifyRequest, reply: FastifyReply, id: string): Promise<ManagedUser | null> {
  const target = await prisma.user.findUnique({ where: { id }, select: { ...SAFE_USER, clinicId: true } });
  if (!target) {
    reply.status(404).send({ error: 'User not found' });
    return null;
  }
  if (target.role === 'SUPER_ADMIN') {
    reply.status(403).send({ error: "Platform administrator accounts can't be changed here" });
    return null;
  }
  if (!assertClinicMatch(request, reply, target.clinicId)) return null;
  return target;
}

async function isLastActiveAdmin(target: { id: string; clinicId: string }): Promise<boolean> {
  const others = await prisma.user.count({ where: { clinicId: target.clinicId, role: 'ADMIN', isActive: true, id: { not: target.id } } });
  return others === 0;
}

/** What this person has recorded or done, in words - empty if nothing. */
async function recordedWork(userId: string): Promise<string[]> {
  const checks: Array<[string, Promise<number>]> = [
    ['recorded actions', prisma.auditLog.count({ where: { actorUserId: userId } })],
    ['appointments', prisma.appointment.count({ where: { doctorId: userId } })],
    ['reproductive health records', prisma.reproductiveHealthRecord.count({ where: { recordedById: userId } })],
    ['documents', prisma.document.count({ where: { uploadedByUserId: userId } })],
    ['notes', prisma.comment.count({ where: { authorId: userId } })],
    ['dispensed prescriptions', prisma.prescription.count({ where: { dispensedByUserId: userId } })],
    ['referrals', prisma.referral.count({ where: { referredByUserId: userId } })],
    ['admissions', prisma.admission.count({ where: { OR: [{ admittedByUserId: userId }, { attendingDoctorId: userId }, { dischargedByUserId: userId }] } })],
    ['ward notes', prisma.admissionNote.count({ where: { authorUserId: userId } })],
    ['visits', prisma.consultation.count({ where: { recordedByUserId: userId } })],
    ['lab results', prisma.labTest.count({ where: { OR: [{ resultedByUserId: userId }, { verifiedByUserId: userId }] } })],
  ];
  const counts = await Promise.all(checks.map(([, count]) => count));
  return checks.filter((_, i) => counts[i] > 0).map(([label]) => label);
}

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 8) return 'The password must be at least 8 characters';
  return null;
}
