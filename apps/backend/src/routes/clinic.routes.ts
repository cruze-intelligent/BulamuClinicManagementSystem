import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcrypt';

export async function clinicRoutes(fastify: FastifyInstance) {
  
  fastify.post('/clinics/register', async (request, reply) => {
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