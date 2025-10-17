import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireRole } from '../middleware/rbac.middleware';

export async function reportsRoutes(fastify: FastifyInstance) {
  
  // Monthly report
  fastify.get('/reports/monthly/:clinicId', { preHandler: [requireRole('ADMIN', 'DOCTOR')] }, async (request, reply) => {
    const { clinicId } = request.params as any;
    const { month, year } = request.query as any;

    try {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59);

      const [totalPatients, totalAppointments, totalConsultations, revenue, topDiagnoses] = await Promise.all([
        prisma.patient.count({ 
          where: { 
            clinicId, 
            createdAt: { gte: startDate, lte: endDate } 
          } 
        }),
        prisma.appointment.count({ 
          where: { 
            clinicId, 
            date: { gte: startDate, lte: endDate } 
          } 
        }),
        prisma.consultation.count({ 
          where: { 
            createdAt: { gte: startDate, lte: endDate },
            appointment: { clinicId }
          } 
        }),
        prisma.invoice.aggregate({ 
          where: { 
            clinicId, 
            status: 'PAID',
            paidAt: { gte: startDate, lte: endDate }
          },
          _sum: { amount: true }
        }),
        prisma.consultation.groupBy({
          by: ['diagnosis'],
          where: {
            createdAt: { gte: startDate, lte: endDate },
            appointment: { clinicId }
          },
          _count: { diagnosis: true },
          orderBy: { _count: { diagnosis: 'desc' } },
          take: 5
        })
      ]);

      return {
        success: true,
        report: {
          period: `${month}/${year}`,
          totalPatients,
          totalAppointments,
          totalConsultations,
          revenue: revenue._sum.amount || 0,
          topDiagnoses
        }
      };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });
}