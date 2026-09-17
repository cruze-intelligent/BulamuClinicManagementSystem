import { FastifyInstance } from 'fastify';
import { prisma, isUniqueConstraintError } from '../lib/prisma';
import { requireRole } from '../middleware/rbac.middleware';
import { authenticate, getAuthUser } from '../middleware/auth.middleware';
import { recordAudit } from '../lib/audit';
import { sendMail, facilityApprovedEmail } from '../lib/mailer';
import { generateFacilityCode, normalizePhoneKey, findDuplicateFacility, duplicateFacilityMessage } from '../lib/facility';
import bcrypt from 'bcrypt';

const TRIAL_LENGTH_MS = 14 * 24 * 60 * 60 * 1000; // 2-week free trial
const DEFAULT_SUBSCRIPTION_AMOUNT = 100000; // UGX/month

export async function clinicRoutes(fastify: FastifyInstance) {
  // Facilities awaiting approval (SUPER_ADMIN only - this is the private
  // approvals queue, never linked from anywhere public).
  fastify.get('/super-admin/pending-clinics', { preHandler: [requireRole('SUPER_ADMIN')] }, async (_request, reply) => {
    try {
      const clinics = await prisma.clinic.findMany({
        where: { registrationStatus: 'PENDING', deletedAt: null },
        orderBy: { createdAt: 'asc' },
        include: {
          users: { where: { role: 'ADMIN' }, select: { id: true, name: true, email: true }, take: 1 },
        },
      });
      return {
        success: true,
        clinics: clinics.map((clinic) => ({
          id: clinic.id, facilityCode: clinic.facilityCode, name: clinic.name, facilityType: clinic.facilityType,
          phone: clinic.phone, address: clinic.address,
          district: clinic.district, subCounty: clinic.subCounty, parish: clinic.parish,
          createdAt: clinic.createdAt, admin: clinic.users[0] || null,
        })),
      };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // Approve a pending facility: activates it and starts its 2-week trial.
  fastify.patch('/clinics/:id/approve', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
    const { id } = request.params as any;
    try {
      const existing = await prisma.clinic.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send({ error: 'Facility not found' });
      if (existing.registrationStatus !== 'PENDING') {
        return reply.status(400).send({ error: 'Only a pending facility can be approved' });
      }

      const authUser = getAuthUser(request);
      const [clinic] = await prisma.$transaction([
        prisma.clinic.update({
          where: { id },
          data: { registrationStatus: 'APPROVED', isActive: true, approvedAt: new Date(), approvedBy: authUser.userId },
        }),
        prisma.user.updateMany({ where: { clinicId: id, role: { not: 'SUPER_ADMIN' } }, data: { isActive: true } }),
        prisma.subscription.upsert({
          where: { clinicId: id },
          update: {},
          create: {
            clinicId: id,
            status: 'TRIALING',
            trialEndsAt: new Date(Date.now() + TRIAL_LENGTH_MS),
            amount: DEFAULT_SUBSCRIPTION_AMOUNT,
            currency: 'UGX',
          },
        }),
      ]);

      await recordAudit({ entity: 'Clinic', recordId: id, clinicId: id, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { registrationStatus: 'APPROVED' } });

      const admin = await prisma.user.findFirst({ where: { clinicId: id, role: 'ADMIN' } });
      if (admin) {
        const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/login`;
        await sendMail({
          to: admin.email,
          subject: `${clinic.name} is approved on Bulamu`,
          html: facilityApprovedEmail(clinic.name, loginUrl),
        });
      }

      return { success: true, clinic };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });

  // Reject a pending facility.
  fastify.patch('/clinics/:id/reject', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
    const { id } = request.params as any;
    const { reason } = request.body as any;
    try {
      const existing = await prisma.clinic.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send({ error: 'Facility not found' });
      if (existing.registrationStatus !== 'PENDING') {
        return reply.status(400).send({ error: 'Only a pending facility can be rejected' });
      }

      const authUser = getAuthUser(request);
      const clinic = await prisma.clinic.update({
        where: { id },
        data: { registrationStatus: 'REJECTED', isActive: false, rejectionReason: reason || null },
      });

      await recordAudit({ entity: 'Clinic', recordId: id, clinicId: id, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { registrationStatus: 'REJECTED', reason } });
      return { success: true, clinic };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });

  // Facility directory: non-sensitive listing any authenticated staff member
  // can see, so a clinic can pick a destination when referring a patient.
  fastify.get('/clinics', { preHandler: [authenticate] }, async (_request, reply) => {
    try {
      const clinics = await prisma.clinic.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true, name: true, facilityType: true, district: true, subCounty: true, parish: true },
        orderBy: { name: 'asc' },
      });

      return { success: true, clinics };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/super-admin/overview', { preHandler: [requireRole('SUPER_ADMIN')] }, async (_request, reply) => {
    try {
      const [clinicCount, activeClinicCount, userCount, patientCount, appointmentCount, consultationCount, revenue, clinics] =
        await Promise.all([
          prisma.clinic.count({ where: { deletedAt: null } }),
          prisma.clinic.count({ where: { isActive: true, deletedAt: null } }),
          prisma.user.count({ where: { isActive: true } }),
          prisma.patient.count(),
          prisma.appointment.count(),
          prisma.consultation.count(),
          prisma.invoice.aggregate({ where: { status: 'PAID' }, _sum: { amount: true } }),
          prisma.clinic.findMany({
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            include: {
              _count: {
                select: {
                  users: true,
                  patients: true
                }
              },
              users: {
                where: { role: 'ADMIN' },
                select: {
                  id: true,
                  name: true,
                  email: true,
                  isActive: true
                },
                take: 1
              },
              subscription: {
                select: { status: true, plan: true, amount: true, trialEndsAt: true, currentPeriodEnd: true }
              }
            }
          })
        ]);

      return {
        success: true,
        overview: {
          clinicCount,
          activeClinicCount,
          userCount,
          patientCount,
          appointmentCount,
          consultationCount,
          revenue: revenue._sum.amount || 0,
          evaluationEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          clinics: clinics.map((clinic) => ({
            id: clinic.id,
            facilityCode: clinic.facilityCode,
            name: clinic.name,
            facilityType: clinic.facilityType,
            phone: clinic.phone,
            address: clinic.address,
            isActive: clinic.isActive,
            createdAt: clinic.createdAt,
            users: clinic._count.users,
            patients: clinic._count.patients,
            admin: clinic.users[0] || null,
            subscription: clinic.subscription
          }))
        }
      };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });
  
  // Register new clinic (SUPER_ADMIN only)
  fastify.post('/clinics/register', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
    const { name, facilityType = 'CLINIC', phone, address, adminEmail, adminPassword, adminName } = request.body as any;

    try {
      const duplicate = await findDuplicateFacility(phone);
      if (duplicate) {
        return reply.status(409).send({ error: duplicateFacilityMessage(duplicate) });
      }

      const existingUser = await prisma.user.findUnique({ where: { email: adminEmail } });
      if (existingUser) {
        return reply.status(409).send({ error: 'An account with this email already exists' });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      const facilityCode = await generateFacilityCode();

      const clinic = await prisma.clinic.create({
        data: {
          facilityCode,
          name,
          facilityType,
          phone,
          phoneKey: normalizePhoneKey(phone),
          address,
          registrationStatus: 'APPROVED',
          approvedAt: new Date(),
          approvedBy: getAuthUser(request).userId,
          users: {
            create: {
              email: adminEmail,
              password: hashedPassword,
              name: adminName,
              role: 'ADMIN'
            }
          },
          subscription: {
            create: {
              status: 'TRIALING',
              trialEndsAt: new Date(Date.now() + TRIAL_LENGTH_MS),
              amount: DEFAULT_SUBSCRIPTION_AMOUNT,
              currency: 'UGX',
            },
          },
        },
        include: {
          users: true
        }
      });

      return { success: true, clinic };
    } catch (error: any) {
      if (isUniqueConstraintError(error)) {
        return reply.status(409).send({ error: 'An account with this email already exists' });
      }
      return reply.status(400).send({ error: error.message });
    }
  });

  fastify.patch('/clinics/:id/status', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
    const { id } = request.params as any;
    const { isActive } = request.body as any;

    try {
      const clinic = await prisma.clinic.update({
        where: { id },
        data: { isActive: Boolean(isActive) },
        select: {
          id: true,
          name: true,
          isActive: true
        }
      });

      await prisma.user.updateMany({
        where: { clinicId: id, role: { not: 'SUPER_ADMIN' } },
        data: { isActive: Boolean(isActive) }
      });

      return { success: true, clinic };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });

  // Permanently remove a facility from the active system (SUPER_ADMIN only).
  // This is a soft delete: clinical records are retained for audit/legal
  // retention, but the facility disappears from every listing and its staff
  // lose access immediately. Requires typing the exact facility name back as
  // confirmation, same pattern as GitHub's "delete this repository".
  fastify.delete('/clinics/:id', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
    const { id } = request.params as any;
    const { confirmName } = request.body as any;

    try {
      const clinic = await prisma.clinic.findUnique({
        where: { id },
        include: { users: { where: { role: 'SUPER_ADMIN' }, select: { id: true } } },
      });
      if (!clinic || clinic.deletedAt) return reply.status(404).send({ error: 'Facility not found' });
      if (clinic.users.length > 0) {
        return reply.status(400).send({ error: 'This facility hosts administrator accounts and cannot be deleted' });
      }
      if (confirmName !== clinic.name) {
        return reply.status(400).send({ error: 'Facility name confirmation did not match' });
      }

      const authUser = getAuthUser(request);
      await prisma.$transaction([
        prisma.clinic.update({
          where: { id },
          data: { deletedAt: new Date(), deletedBy: authUser.userId, isActive: false },
        }),
        prisma.user.updateMany({ where: { clinicId: id }, data: { isActive: false } }),
      ]);

      await recordAudit({ entity: 'Clinic', recordId: id, clinicId: id, action: 'DELETE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { name: clinic.name, facilityCode: clinic.facilityCode } });

      return { success: true };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });
}
