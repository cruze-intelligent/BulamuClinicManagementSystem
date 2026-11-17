import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate, resolveClinicScope } from '../middleware/auth.middleware';
import { sendRouteError } from '../lib/http-error';
import { eatDayRange } from '../lib/invoices';

export async function dashboardRoutes(fastify: FastifyInstance) {

  // Dashboard stats
  fastify.get('/dashboard/:clinicId', { preHandler: [authenticate] }, async (request, reply) => {
    const { clinicId: requestedClinicId } = request.params as any;
    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;
    // Today starts at midnight in Kampala, wherever the server runs.
    const today = eatDayRange().start;

    try {
      const [totalPatients, todayAppointments, pendingInvoices, totalRevenue] = await Promise.all([
        prisma.patient.count({ where: { clinicId, deletedAt: null } }),
        prisma.appointment.count({
          where: { clinicId, deletedAt: null, date: { gte: today }, status: 'SCHEDULED' }
        }),
        prisma.invoice.count({ where: { clinicId, status: 'PENDING' } }),
        // Money actually received (payments that stand), not bills raised.
        prisma.patientPayment.aggregate({
          where: { clinicId, voidedAt: null },
          _sum: { amount: true }
        })
      ]);

      const appointments = await prisma.appointment.findMany({
        where: { clinicId, deletedAt: null, date: { gte: today } },
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
      return sendRouteError(reply, error);
    }
  });

  // Search patients
  fastify.get('/search/patients', { preHandler: [authenticate] }, async (request, reply) => {
    const { q, clinicId: requestedClinicId } = request.query as any;
    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;

    try {
      const patients = await prisma.patient.findMany({
        where: {
          clinicId,
          deletedAt: null,
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
            // "42" or "00042": the facility's Patient ID.
            ...(/^\d{1,7}$/.test(String(q ?? '').trim()) && Number(q) > 0 ? [{ patientNumber: Number(q) }] : []),
          ]
        },
        take: 20
      });

      return { success: true, patients };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });
}