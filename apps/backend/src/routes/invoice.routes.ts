import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';

export async function invoiceRoutes(fastify: FastifyInstance) {
  
  // Get all invoices for clinic
  fastify.get('/invoices/:clinicId', { preHandler: [authenticate] }, async (request, reply) => {
    const { clinicId } = request.params as any;
    const { status } = request.query as any;

    try {
      const invoices = await prisma.invoice.findMany({
        where: { 
          clinicId,
          ...(status && { status })
        },
        include: {
          consultation: {
            include: {
              patient: true,
              appointment: {
                include: {
                  doctor: { select: { name: true } }
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      return { success: true, invoices };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

// Mark invoice as paid (ADMIN & DOCTOR only)
  fastify.patch('/invoices/:id/pay', { preHandler: [requireRole('ADMIN', 'DOCTOR')] }, async (request, reply) => {
    const { id } = request.params as any;

    try {
      const invoice = await prisma.invoice.update({
        where: { id },
        data: { 
          status: 'PAID',
          paidAt: new Date()
        }
      });

      return { success: true, invoice };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });
}