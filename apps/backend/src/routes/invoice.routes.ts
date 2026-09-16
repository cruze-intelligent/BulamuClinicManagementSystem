import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate, resolveClinicScope, assertClinicMatch, getAuthUser } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { recordAudit } from '../lib/audit';
import { generateInvoicePdf } from '../lib/pdf';

export async function invoiceRoutes(fastify: FastifyInstance) {

  // Get all invoices for clinic
  fastify.get('/invoices/:clinicId', { preHandler: [authenticate] }, async (request, reply) => {
    const { clinicId: requestedClinicId } = request.params as any;
    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;
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
      const existing = await prisma.invoice.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ error: 'Invoice not found' });
      }
      if (!assertClinicMatch(request, reply, existing.clinicId)) return;

      const invoice = await prisma.invoice.update({
        where: { id },
        data: {
          status: 'PAID',
          paidAt: new Date()
        }
      });

      const authUser = getAuthUser(request);
      await recordAudit({
        entity: 'Invoice', recordId: invoice.id, clinicId: invoice.clinicId,
        action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { status: 'PAID', amount: invoice.amount },
      });

      return { success: true, invoice };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });

  // Download a branded PDF of an invoice
  fastify.get('/invoices/:id/pdf', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as any;

    try {
      const invoice = await prisma.invoice.findUnique({
        where: { id },
        include: {
          consultation: {
            include: {
              patient: { include: { clinic: { select: { name: true } } } },
              appointment: { include: { doctor: { select: { name: true } } } },
            },
          },
        },
      });
      if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
      if (!assertClinicMatch(request, reply, invoice.clinicId)) return;

      const pdf = await generateInvoicePdf({
        invoiceId: invoice.id,
        clinicName: invoice.consultation.patient.clinic.name,
        patientName: invoice.consultation.patient.name,
        patientPhone: invoice.consultation.patient.phone,
        diagnosis: invoice.consultation.diagnosis,
        doctorName: invoice.consultation.appointment.doctor?.name,
        amount: invoice.amount,
        status: invoice.status,
        createdAt: invoice.createdAt,
        paidAt: invoice.paidAt,
      });

      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="invoice-${invoice.id}.pdf"`);
      return reply.send(pdf);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });
}