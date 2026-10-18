import { FastifyInstance } from 'fastify';
import { prisma, isUniqueConstraintError } from '../lib/prisma';
import { authenticate, resolveClinicScope, assertClinicMatch, getAuthUser } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { recordAudit } from '../lib/audit';
import { generateInvoicePdf } from '../lib/pdf';
import { parseFee } from '../lib/invoices';
import { facilityLogo } from '../lib/facility-logo';
import { documentProducer } from '../lib/document-signer';
import { sendRouteError } from '../lib/http-error';

// Patient invoices are each facility's own bills to its patients: the facility
// charges and collects the money, Bulamu only keeps the record.
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
      return sendRouteError(reply, error);
    }
  });

  // Charge for a consultation that was recorded without a fee (the same roles
  // that can mark an invoice paid).
  fastify.post('/invoices', { preHandler: [requireRole('ADMIN', 'DOCTOR')] }, async (request, reply) => {
    const { consultationId, amount } = (request.body ?? {}) as { consultationId?: string; amount?: unknown };
    let fee: number | null;
    try {
      fee = parseFee(amount);
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
    }
    if (!fee) return reply.status(400).send({ error: 'Enter the amount to charge' });

    try {
      const consultation = await prisma.consultation.findUnique({
        where: { id: String(consultationId ?? '') },
        include: { appointment: { select: { clinicId: true } } },
      });
      if (!consultation || consultation.deletedAt) return reply.status(404).send({ error: 'Consultation not found' });
      if (!assertClinicMatch(request, reply, consultation.appointment.clinicId)) return;

      const invoice = await prisma.invoice.create({
        data: { consultationId: consultation.id, clinicId: consultation.appointment.clinicId, amount: fee },
      });
      const authUser = getAuthUser(request);
      await recordAudit({
        entity: 'Invoice', recordId: invoice.id, clinicId: invoice.clinicId,
        action: 'CREATE', actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { amount: fee },
      });
      return { success: true, invoice };
    } catch (error: any) {
      if (isUniqueConstraintError(error)) return reply.status(409).send({ error: 'This consultation already has an invoice' });
      return sendRouteError(reply, error, 400);
    }
  });

  // Mark an unpaid invoice as paid - once (ADMIN & DOCTOR only).
  fastify.patch('/invoices/:id/pay', { preHandler: [requireRole('ADMIN', 'DOCTOR')] }, async (request, reply) => {
    const { id } = request.params as any;

    try {
      const existing = await prisma.invoice.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ error: 'Invoice not found' });
      }
      if (!assertClinicMatch(request, reply, existing.clinicId)) return;
      if (existing.status !== 'PENDING') {
        return reply.status(409).send({ error: existing.status === 'PAID' ? 'This invoice is already paid' : 'This invoice was cancelled' });
      }

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
      return sendRouteError(reply, error, 400);
    }
  });

  // Cancel an unpaid invoice (charged by mistake, or waived). Kept, marked cancelled.
  fastify.patch('/invoices/:id/cancel', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const { id } = request.params as any;

    try {
      const existing = await prisma.invoice.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send({ error: 'Invoice not found' });
      if (!assertClinicMatch(request, reply, existing.clinicId)) return;
      if (existing.status !== 'PENDING') {
        return reply.status(409).send({ error: existing.status === 'PAID' ? "A paid invoice can't be cancelled" : 'This invoice is already cancelled' });
      }

      const invoice = await prisma.invoice.update({ where: { id }, data: { status: 'CANCELLED' } });
      const authUser = getAuthUser(request);
      await recordAudit({
        entity: 'Invoice', recordId: invoice.id, clinicId: invoice.clinicId,
        action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { status: 'CANCELLED', amount: invoice.amount },
      });
      return { success: true, invoice };
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
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
              patient: { include: { clinic: { select: { id: true, name: true, facilityCode: true, phone: true } } } },
              appointment: { include: { doctor: { select: { name: true } } } },
            },
          },
        },
      });
      if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
      if (!assertClinicMatch(request, reply, invoice.clinicId)) return;

      const clinic = invoice.consultation.patient.clinic;
      const pdf = await generateInvoicePdf({
        invoiceId: invoice.id,
        clinicName: clinic.name,
        facilityCode: clinic.facilityCode,
        clinicPhone: clinic.phone,
        clinicLogo: await facilityLogo(clinic.id),
        patientName: invoice.consultation.patient.name,
        patientPhone: invoice.consultation.patient.phone,
        diagnosis: invoice.consultation.diagnosis,
        doctorName: invoice.consultation.appointment.doctor?.name,
        amount: invoice.amount,
        status: invoice.status,
        createdAt: invoice.createdAt,
        paidAt: invoice.paidAt,
        producedBy: await documentProducer(getAuthUser(request).userId),
      });

      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="invoice-${invoice.id.slice(0, 8)}.pdf"`);
      return reply.send(pdf);
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });
}
