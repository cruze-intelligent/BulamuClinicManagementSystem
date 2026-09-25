import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireRole } from '../middleware/rbac.middleware';
import { assertClinicMatch, getAuthUser } from '../middleware/auth.middleware';
import { recordAudit } from '../lib/audit';
import { notifyIfLowStock } from '../lib/notifications';

const MAX_QUANTITY = 100000;
const PENDING_LIMIT = 300;
const RECENT_LIMIT = 50;

class DispensingError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

function parseQuantity(value: unknown): number | null | 'invalid' {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= MAX_QUANTITY ? n : 'invalid';
}

/**
 * Dispensing: the pharmacist works through the prescriptions waiting at their
 * facility, hands each one out, and stock comes off the shelf as they do. Only
 * pharmacists and facility admins can dispense; everything is scoped to the
 * caller's own facility.
 */
export async function dispensingRoutes(fastify: FastifyInstance) {
  // The queue (?status=pending, oldest first) or what was recently handed out
  // (?status=dispensed, newest first, so a mistake can be found and reversed).
  fastify.get('/prescriptions', { preHandler: [requireRole('PHARMACIST', 'ADMIN')] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const dispensedView = (request.query as { status?: string })?.status === 'dispensed';

    try {
      const rows = await prisma.prescription.findMany({
        where: {
          consultation: { deletedAt: null, appointment: { clinicId: authUser.clinicId } },
          ...(dispensedView ? { dispensedAt: { not: null }, dispensedByUserId: { not: null } } : { dispensedAt: null }),
        },
        orderBy: dispensedView ? { dispensedAt: 'desc' } : { createdAt: 'asc' },
        take: dispensedView ? RECENT_LIMIT : PENDING_LIMIT,
        include: {
          medicine: { select: { id: true, name: true, quantity: true, unit: true, reorderLevel: true } },
          dispensedBy: { select: { name: true } },
          consultation: {
            select: {
              id: true, createdAt: true,
              patient: { select: { id: true, name: true, sex: true, dateOfBirth: true, allergyStatus: true, allergies: true } },
              appointment: { select: { doctor: { select: { name: true } } } },
              diagnoses: { where: { type: 'PRIMARY' }, select: { icd10Code: true, description: true }, take: 1 },
            },
          },
        },
      });

      return {
        success: true,
        items: rows.map(({ consultation, ...rx }) => ({
          ...rx,
          consultation: {
            id: consultation.id,
            createdAt: consultation.createdAt,
            prescriber: consultation.appointment.doctor?.name ?? null,
            diagnosis: consultation.diagnoses[0] ?? null,
          },
          patient: consultation.patient,
        })),
      };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // Mark one prescription item as dispensed. If it is linked to a stock item the
  // quantity comes off that stock in the same step, and the request is refused
  // (nothing changes) when there is not enough - stock can never go negative,
  // and two pharmacists dispensing the same item cannot both succeed.
  fastify.post('/prescriptions/:id/dispense', { preHandler: [requireRole('PHARMACIST', 'ADMIN')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const authUser = getAuthUser(request);
    const requested = parseQuantity((request.body as any)?.quantity);
    if (requested === 'invalid') return reply.status(400).send({ error: `Quantity must be a whole number between 1 and ${MAX_QUANTITY}` });

    try {
      const existing = await prisma.prescription.findFirst({
        where: { id, consultation: { deletedAt: null } },
        include: { consultation: { select: { appointment: { select: { clinicId: true } } } } },
      });
      if (!existing) return reply.status(404).send({ error: 'Prescription not found' });
      if (!assertClinicMatch(request, reply, existing.consultation.appointment.clinicId)) return;
      if (existing.dispensedAt) return reply.status(409).send({ error: 'This prescription has already been dispensed' });

      const quantity = requested ?? existing.quantity;
      if (existing.medicineId && !quantity) {
        return reply.status(400).send({ error: 'Enter the quantity being dispensed, so it can be taken off stock' });
      }

      const { medicine, previousQuantity } = await prisma.$transaction(async (tx) => {
        let stock: { id: string; clinicId: string; name: string; quantity: number; unit: string; reorderLevel: number } | null = null;
        let before = 0;

        if (existing.medicineId && quantity) {
          const item = await tx.medicine.findFirst({ where: { id: existing.medicineId, clinicId: authUser.clinicId, deletedAt: null } });
          if (item) {
            // Conditional decrement: only succeeds while enough is on the shelf.
            const taken = await tx.medicine.updateMany({
              where: { id: item.id, quantity: { gte: quantity } },
              data: { quantity: { decrement: quantity } },
            });
            if (taken.count === 0) {
              const current = await tx.medicine.findUnique({ where: { id: item.id }, select: { quantity: true } });
              throw new DispensingError(409, `Not enough ${item.name} in stock: ${current?.quantity ?? 0} ${item.unit} available, ${quantity} needed`);
            }
            before = item.quantity;
            stock = await tx.medicine.findUniqueOrThrow({ where: { id: item.id } });
          }
        }

        // Only one request can move it from waiting to dispensed.
        const marked = await tx.prescription.updateMany({
          where: { id, dispensedAt: null },
          data: { dispensedAt: new Date(), dispensedByUserId: authUser.userId, dispensedQuantity: quantity ?? null },
        });
        if (marked.count === 0) throw new DispensingError(409, 'This prescription has already been dispensed');

        return { medicine: stock, previousQuantity: stock ? before : null };
      });

      await recordAudit({
        entity: 'Prescription', recordId: id, clinicId: authUser.clinicId, action: 'UPDATE',
        actorUserId: authUser.userId, actorRole: authUser.role, metadata: { event: 'DISPENSED', quantity: quantity ?? null },
      });
      if (medicine) await notifyIfLowStock(medicine, previousQuantity, (message) => fastify.log.warn(message));

      const prescription = await prisma.prescription.findUniqueOrThrow({ where: { id }, include: { dispensedBy: { select: { name: true } } } });
      return { success: true, prescription, medicine };
    } catch (error: any) {
      if (error instanceof DispensingError) return reply.status(error.statusCode).send({ error: error.message });
      return reply.status(500).send({ error: error.message });
    }
  });

  // Undo a dispense that was a mistake: the item goes back in the queue and the
  // quantity goes back on the shelf.
  fastify.post('/prescriptions/:id/undo-dispense', { preHandler: [requireRole('PHARMACIST', 'ADMIN')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const authUser = getAuthUser(request);

    try {
      const existing = await prisma.prescription.findFirst({
        where: { id, consultation: { deletedAt: null } },
        include: { consultation: { select: { appointment: { select: { clinicId: true } } } } },
      });
      if (!existing) return reply.status(404).send({ error: 'Prescription not found' });
      if (!assertClinicMatch(request, reply, existing.consultation.appointment.clinicId)) return;
      if (!existing.dispensedAt) return reply.status(409).send({ error: 'This prescription has not been dispensed' });
      // Items marked dispensed only because they predate dispensing records have no
      // record of who or how much - there is nothing to reverse.
      if (!existing.dispensedByUserId) return reply.status(409).send({ error: 'This prescription was recorded as dispensed before dispensing was tracked and cannot be reversed' });

      await prisma.$transaction(async (tx) => {
        if (existing.medicineId && existing.dispensedQuantity) {
          await tx.medicine.updateMany({
            where: { id: existing.medicineId, clinicId: authUser.clinicId },
            data: { quantity: { increment: existing.dispensedQuantity } },
          });
        }
        const cleared = await tx.prescription.updateMany({
          where: { id, dispensedAt: { not: null } },
          data: { dispensedAt: null, dispensedByUserId: null, dispensedQuantity: null },
        });
        if (cleared.count === 0) throw new DispensingError(409, 'This prescription has not been dispensed');
      });

      await recordAudit({
        entity: 'Prescription', recordId: id, clinicId: authUser.clinicId, action: 'UPDATE',
        actorUserId: authUser.userId, actorRole: authUser.role, metadata: { event: 'DISPENSE_REVERSED', quantity: existing.dispensedQuantity },
      });
      return { success: true };
    } catch (error: any) {
      if (error instanceof DispensingError) return reply.status(error.statusCode).send({ error: error.message });
      return reply.status(500).send({ error: error.message });
    }
  });
}
