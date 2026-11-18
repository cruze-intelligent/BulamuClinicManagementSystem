import type { Role } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { prisma, isUniqueConstraintError } from '../lib/prisma';
import { authenticate, getAuthUser, resolveClinicScope } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { recordAudit } from '../lib/audit';
import { sendRouteError } from '../lib/http-error';
import { eatDayRange } from '../lib/invoices';
import { cleanUnitName, sortDepartments, standardUnit } from '../lib/departments';

/**
 * The facility's units (departments / clinics) - General OPD, Dentistry,
 * Orthopaedics... The administrator sets them up and says who works in each;
 * everyone sees the list, to book patients into a unit and to work its queue.
 */
export async function departmentRoutes(fastify: FastifyInstance) {
  fastify.get('/departments', { preHandler: [authenticate] }, async (request, reply) => {
    const clinicId = resolveClinicScope(request, reply, (request.query as any)?.clinicId);
    if (!clinicId) return;
    const authUser = getAuthUser(request);
    try {
      const [departments, staff, me] = await Promise.all([
        prisma.department.findMany({ where: { clinicId } }),
        prisma.user.findMany({ where: { clinicId, isActive: true }, select: { departmentIds: true } }),
        prisma.user.findUnique({ where: { id: authUser.userId }, select: { departmentIds: true } }),
      ]);
      const count = new Map<string, number>();
      for (const s of staff) for (const id of s.departmentIds) count.set(id, (count.get(id) ?? 0) + 1);
      return {
        success: true,
        departments: sortDepartments(departments).map((d) => ({ ...d, staff: count.get(d.id) ?? 0 })),
        mine: me?.departmentIds ?? [],
      };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // A standard unit by its code ({ code: 'DENTAL' }), or one the facility names ({ name: 'Sickle Cell Clinic' }).
  fastify.post('/departments', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const body = (request.body ?? {}) as { code?: unknown; name?: unknown };
    const standard = body.code !== undefined ? standardUnit(body.code) : undefined;
    if (body.code !== undefined && !standard) return reply.status(400).send({ error: 'That is not one of the standard units' });
    const named = cleanUnitName(body.name ?? standard?.name);
    if ('error' in named) return reply.status(400).send({ error: named.error });

    try {
      if (standard) {
        // A standard unit closed earlier opens again, keeping its past visits.
        const closed = await prisma.department.findFirst({ where: { clinicId: authUser.clinicId, code: standard.code } });
        if (closed) {
          if (closed.isActive) return reply.status(409).send({ error: `${closed.name} is already one of your units` });
          const reopened = await prisma.department.update({ where: { id: closed.id }, data: { isActive: true } });
          await recordAudit({ entity: 'Department', recordId: reopened.id, clinicId: authUser.clinicId, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { reopened: true } });
          return { success: true, department: { ...reopened, staff: 0 } };
        }
      }
      const department = await prisma.department.create({ data: { clinicId: authUser.clinicId, code: standard?.code ?? null, name: named.name } });
      await recordAudit({ entity: 'Department', recordId: department.id, clinicId: authUser.clinicId, action: 'CREATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { name: department.name, code: department.code } });
      return { success: true, department: { ...department, staff: 0 } };
    } catch (error: any) {
      if (isUniqueConstraintError(error)) return reply.status(409).send({ error: `There is already a unit called ${named.name}` });
      return sendRouteError(reply, error);
    }
  });

  // Rename a unit, or close it (its past visits keep its name) and open it again.
  fastify.patch('/departments/:id', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { name?: unknown; isActive?: unknown };
    const department = await prisma.department.findUnique({ where: { id } });
    if (!department || department.clinicId !== authUser.clinicId) return reply.status(404).send({ error: 'Unit not found' });

    const data: { name?: string; isActive?: boolean } = {};
    if (body.name !== undefined) {
      const named = cleanUnitName(body.name);
      if ('error' in named) return reply.status(400).send({ error: named.error });
      data.name = named.name;
    }
    if (body.isActive !== undefined) {
      if (body.isActive === false && department.isActive) {
        const { start, end } = eatDayRange();
        const waiting = await prisma.appointment.count({
          where: { departmentId: id, deletedAt: null, status: 'SCHEDULED', checkedInAt: { not: null }, date: { gte: new Date(start.getTime() - 24 * 60 * 60 * 1000), lt: end } },
        });
        if (waiting > 0) return reply.status(409).send({ error: `${waiting} ${waiting === 1 ? 'patient is' : 'patients are'} waiting in ${department.name} - see them or send them to another unit before closing it` });
      }
      data.isActive = Boolean(body.isActive);
    }

    try {
      const updated = await prisma.department.update({ where: { id }, data });
      await recordAudit({ entity: 'Department', recordId: id, clinicId: authUser.clinicId, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: data });
      return { success: true, department: updated };
    } catch (error: any) {
      if (isUniqueConstraintError(error)) return reply.status(409).send({ error: `There is already a unit called ${data.name}` });
      return sendRouteError(reply, error);
    }
  });

  // The units a member of staff works in. None: they work across the facility.
  fastify.put('/users/:id/departments', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as { id: string };
    const raw = (request.body as { departmentIds?: unknown } | undefined)?.departmentIds;
    if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string')) return reply.status(400).send({ error: 'Choose the units this person works in' });
    const departmentIds = [...new Set(raw as string[])];

    const user = await prisma.user.findUnique({ where: { id }, select: { clinicId: true, name: true } });
    if (!user || user.clinicId !== authUser.clinicId) return reply.status(404).send({ error: 'Staff member not found' });
    const found = await prisma.department.count({ where: { id: { in: departmentIds }, clinicId: authUser.clinicId } });
    if (found !== departmentIds.length) return reply.status(400).send({ error: 'One of those units is not part of this facility' });

    try {
      const updated = await prisma.user.update({ where: { id }, data: { departmentIds }, select: { id: true, departmentIds: true } });
      await recordAudit({ entity: 'User', recordId: id, clinicId: authUser.clinicId, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { departmentIds } });
      return { success: true, user: updated };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // A person's other duties: the roles they also work in (a nurse who also
  // runs the lab) and whether they may verify lab results. Applies at once.
  fastify.put('/users/:id/duties', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { extraRoles?: unknown; canVerifyLab?: unknown };
    if (!Array.isArray(body.extraRoles) || body.extraRoles.some((r) => typeof r !== 'string' || !EXTRA_ROLES.includes(r as Role))) {
      return reply.status(400).send({ error: 'Choose the other roles from the list' });
    }
    if (body.canVerifyLab !== undefined && typeof body.canVerifyLab !== 'boolean') return reply.status(400).send({ error: 'Say whether they may verify lab results' });

    const user = await prisma.user.findUnique({ where: { id }, select: { clinicId: true, role: true } });
    if (!user || user.clinicId !== authUser.clinicId) return reply.status(404).send({ error: 'Staff member not found' });
    // Their own role needs no second mention.
    const extraRoles = [...new Set(body.extraRoles as Role[])].filter((r) => r !== user.role);
    try {
      const updated = await prisma.user.update({
        where: { id },
        data: { extraRoles, ...(body.canVerifyLab === undefined ? {} : { canVerifyLab: body.canVerifyLab }) },
        select: { id: true, extraRoles: true, canVerifyLab: true },
      });
      await recordAudit({ entity: 'User', recordId: id, clinicId: authUser.clinicId, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { extraRoles: updated.extraRoles, canVerifyLab: updated.canVerifyLab } });
      return { success: true, user: updated };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });
}

/** The roles a person may also work in - every staff role except the administrator's and the platform's own. */
const EXTRA_ROLES: Role[] = ['DOCTOR', 'NURSE', 'STAFF', 'PHARMACIST', 'LAB_TECH', 'RADIOGRAPHER'];
