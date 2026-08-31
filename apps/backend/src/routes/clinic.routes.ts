import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireRole } from '../middleware/rbac.middleware';
import bcrypt from 'bcrypt';

export async function clinicRoutes(fastify: FastifyInstance) {
  fastify.get('/super-admin/overview', { preHandler: [requireRole('SUPER_ADMIN')] }, async (_request, reply) => {
    try {
      const [clinicCount, activeClinicCount, userCount, patientCount, appointmentCount, consultationCount, revenue, clinics] =
        await Promise.all([
          prisma.clinic.count(),
          prisma.clinic.count({ where: { isActive: true } }),
          prisma.user.count({ where: { isActive: true } }),
          prisma.patient.count(),
          prisma.appointment.count(),
          prisma.consultation.count(),
          prisma.invoice.aggregate({ where: { status: 'PAID' }, _sum: { amount: true } }),
          prisma.clinic.findMany({
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
            name: clinic.name,
            facilityType: clinic.facilityType,
            phone: clinic.phone,
            address: clinic.address,
            isActive: clinic.isActive,
            createdAt: clinic.createdAt,
            users: clinic._count.users,
            patients: clinic._count.patients,
            admin: clinic.users[0] || null
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
      // Hash password
      const hashedPassword = await bcrypt.hash(adminPassword, 10);

      const clinic = await prisma.clinic.create({
        data: {
          name,
          facilityType,
          phone,
          address,
          users: {
            create: {
              email: adminEmail,
              password: hashedPassword,
              name: adminName,
              role: 'ADMIN'
            }
          }
        },
        include: {
          users: true
        }
      });

      return { success: true, clinic };
    } catch (error: any) {
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
}
