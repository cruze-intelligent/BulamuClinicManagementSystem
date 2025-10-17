import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireRole } from '../middleware/rbac.middleware';
import bcrypt from 'bcrypt';

export async function clinicRoutes(fastify: FastifyInstance) {
  
  // Register new clinic (SUPER_ADMIN only)
  fastify.post('/clinics/register', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
    const { name, phone, address, adminEmail, adminPassword, adminName } = request.body as any;

    try {
      // Hash password
      const hashedPassword = await bcrypt.hash(adminPassword, 10);

      const clinic = await prisma.clinic.create({
        data: {
          name,
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
}