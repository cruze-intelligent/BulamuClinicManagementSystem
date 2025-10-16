import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth.middleware';

export async function dashboardRoutes(fastify: FastifyInstance) {
  
  // Dashboard stats
  fastify.get('/dashboard/:clinicId', { preHandler: [authenticate] }, async (request, reply) => {
    const { clinicId } = request.params as any;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
      const [totalPatients, todayAppointments, pendingInvoices, totalRevenue] = await Promise.all([
        prisma.patient.count({ where: { clinicId } }),
        prisma.appointment.count({ 
          where: { clinicId, date: { gte: today }, status: 'SCHEDULED' } 
        }),
        prisma.invoice.count({ where: { clinicId, status: 'PENDING' } }),
        prisma.invoice.aggregate({ 
          where: { clinicId, status: 'PAID' },
          _sum: { amount: true }
        })
      ]);

      const appointments = await prisma.appointment.findMany({
        where: { clinicId, date: { gte: today } },
        include: { patient: true, doctor: { select: { name: true } } },
        orderBy: { time: 'asc' },
        take: 10
      });

      return {
        success: true,
        stats: {
          totalPatients,
          todayAppointments,
          pendingInvoices,
          totalRevenue: totalRevenue._sum.amount || 0
        },
        todayAppointments: appointments
      };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // Search patients
  fastify.get('/search/patients', { preHandler: [authenticate] }, async (request, reply) => {
    const { q, clinicId } = request.query as any;

    try {
      const patients = await prisma.patient.findMany({
        where: {
          clinicId,
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } }
          ]
        },
        take: 20
      });

      return { success: true, patients };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });
}