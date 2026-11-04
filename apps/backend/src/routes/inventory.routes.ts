import { FastifyInstance, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate, resolveClinicScope, assertClinicMatch, getAuthUser } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { notifyIfLowStock } from '../lib/notifications';
import { sendRouteError } from '../lib/http-error';
import { recordAudit } from '../lib/audit';
import { cleanText } from '../lib/invoices';
import {
  MOVEMENT_LABELS, REMOVAL_REASONS, STOCK_ROLES, StockError, countStock, createStockItem, discontinueStockItem, inStockTransaction, isExpired,
  isRemovalReason, parseCount, parseExpiry, parseItemDetails, parsePrice, parseQuantity, receiveStock, removeStock,
} from '../lib/stock';

/**
 * The facility's stock. Anyone at the facility can see it (doctors check it
 * when prescribing); only pharmacists and administrators change it, and every
 * change is a recorded stock movement (lib/stock.ts).
 */
export async function inventoryRoutes(fastify: FastifyInstance) {
  const stockKeepers = { preHandler: [requireRole(...STOCK_ROLES)] };

  const failed = (reply: FastifyReply, error: any) =>
    error instanceof StockError ? reply.status(error.statusCode).send({ error: error.message }) : sendRouteError(reply, error, 400);

  /** The medicine, if it is this caller's facility's and still stocked; replies otherwise. */
  async function stockItem(request: any, reply: FastifyReply) {
    const existing = await prisma.medicine.findUnique({ where: { id: (request.params as { id: string }).id } });
    if (!existing || existing.deletedAt) {
      reply.status(404).send({ error: 'Medicine not found' });
      return null;
    }
    if (!assertClinicMatch(request, reply, existing.clinicId)) return null;
    return existing;
  }

  const lowStockCheck = (result: { medicine: Parameters<typeof notifyIfLowStock>[0]; previousQuantity: number }) =>
    notifyIfLowStock(result.medicine, result.previousQuantity, (message) => fastify.log.warn(message));

  // Every stocked item, with how much of it has expired.
  fastify.get('/inventory/:clinicId', { preHandler: [authenticate] }, async (request, reply) => {
    const clinicId = resolveClinicScope(request, reply, (request.params as any).clinicId);
    if (!clinicId) return;
    try {
      const now = new Date();
      const medicines = await prisma.medicine.findMany({
        where: { clinicId, deletedAt: null },
        orderBy: { name: 'asc' },
        include: { batches: { where: { quantity: { gt: 0 } }, orderBy: { expiryDate: 'asc' } } },
      });
      return {
        success: true,
        medicines: medicines.map(({ batches, ...m }) => ({
          ...m,
          expiredQuantity: batches.filter((b) => isExpired(b, now)).reduce((sum, b) => sum + b.quantity, 0),
          batches: batches.map((b) => ({ id: b.id, quantity: b.quantity, expiryDate: b.expiryDate, receivedAt: b.receivedAt, supplier: b.supplier })),
        })),
      };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // A new stock item, with what is on the shelf now as its opening stock.
  fastify.post('/inventory', stockKeepers, async (request, reply) => {
    const body = (request.body ?? {}) as any;
    const clinicId = resolveClinicScope(request, reply, body.clinicId);
    if (!clinicId) return;
    const authUser = getAuthUser(request);
    try {
      const details = parseItemDetails(body);
      const quantity = parseCount(body.quantity ?? 0, 'The quantity on the shelf');
      const expiryDate = parseExpiry(body.expiryDate);
      const medicine = await inStockTransaction((tx) => createStockItem(tx, {
        ...(details as Required<typeof details>), quantity, expiryDate, clinicId, userId: authUser.userId,
      }));
      await recordAudit({ entity: 'Medicine', recordId: medicine.id, clinicId, action: 'CREATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { name: medicine.name, quantity } });
      await notifyIfLowStock(medicine, null, (message) => fastify.log.warn(message));
      return { success: true, medicine };
    } catch (error: any) {
      return failed(reply, error);
    }
  });

  // Change the details: name, unit, reorder level, price. Quantities change only
  // by receiving, removing or counting stock - so each change is accounted for.
  fastify.patch('/inventory/:id', stockKeepers, async (request, reply) => {
    const body = (request.body ?? {}) as any;
    try {
      const existing = await stockItem(request, reply);
      if (!existing) return;
      if (body.quantity !== undefined || body.expiryDate !== undefined) {
        return reply.status(400).send({ error: 'Quantities change by receiving stock, removing stock or recording a count - so each change is accounted for' });
      }
      const details = parseItemDetails(body, true);
      if (!Object.keys(details).length) return reply.status(400).send({ error: 'Nothing to change' });
      const medicine = await prisma.medicine.update({ where: { id: existing.id }, data: details });
      const authUser = getAuthUser(request);
      await recordAudit({ entity: 'Medicine', recordId: medicine.id, clinicId: medicine.clinicId, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { fields: Object.keys(details) } });
      // A higher reorder level can put an item below it.
      if (details.reorderLevel !== undefined) await notifyIfLowStock(medicine, null, (message) => fastify.log.warn(message));
      return { success: true, medicine };
    } catch (error: any) {
      return failed(reply, error);
    }
  });

  // A delivery: a new batch with its own expiry date.
  fastify.post('/inventory/:id/receive', stockKeepers, async (request, reply) => {
    const body = (request.body ?? {}) as any;
    const authUser = getAuthUser(request);
    try {
      const existing = await stockItem(request, reply);
      if (!existing) return;
      const quantity = parseQuantity(body.quantity, 'The quantity received');
      const expiryDate = parseExpiry(body.expiryDate);
      if (expiryDate && expiryDate.getTime() <= Date.now()) return reply.status(400).send({ error: 'That expiry date has already passed - expired stock should not go on the shelf' });
      const unitCost = body.unitCost === undefined || body.unitCost === '' || body.unitCost === null ? null : parsePrice(body.unitCost);
      const result = await inStockTransaction((tx) => receiveStock(tx, {
        medicineId: existing.id, quantity, expiryDate, unitCost,
        supplier: cleanText(body.supplier, 80), reference: cleanText(body.reference, 80), note: cleanText(body.note, 200),
        clinicId: existing.clinicId, userId: authUser.userId,
      }));
      await lowStockCheck(result);
      return { success: true, medicine: result.medicine };
    } catch (error: any) {
      return failed(reply, error);
    }
  });

  // Stock taken off the shelf, with the reason: damaged, expired, lost, returned.
  fastify.post('/inventory/:id/remove', stockKeepers, async (request, reply) => {
    const body = (request.body ?? {}) as any;
    const authUser = getAuthUser(request);
    try {
      const existing = await stockItem(request, reply);
      if (!existing) return;
      if (!isRemovalReason(body.reason)) return reply.status(400).send({ error: 'Choose why the stock is being removed' });
      const note = cleanText(body.note, 200);
      if (body.reason === 'OTHER' && !note) return reply.status(400).send({ error: 'Say why the stock is being removed' });
      const quantity = parseQuantity(body.quantity, 'The quantity removed');
      const result = await inStockTransaction((tx) => removeStock(tx, {
        medicineId: existing.id, quantity, reason: body.reason, note, clinicId: existing.clinicId, userId: authUser.userId,
      }));
      await lowStockCheck(result);
      return { success: true, medicine: result.medicine };
    } catch (error: any) {
      return failed(reply, error);
    }
  });

  // A stock count: what is actually on the shelf. A difference needs a note.
  fastify.post('/inventory/:id/count', stockKeepers, async (request, reply) => {
    const body = (request.body ?? {}) as any;
    const authUser = getAuthUser(request);
    try {
      const existing = await stockItem(request, reply);
      if (!existing) return;
      const counted = parseCount(body.counted, 'The count');
      const result = await inStockTransaction((tx) => countStock(tx, {
        medicineId: existing.id, counted, note: cleanText(body.note, 200), clinicId: existing.clinicId, userId: authUser.userId,
      }));
      await lowStockCheck(result);
      return { success: true, medicine: result.medicine };
    } catch (error: any) {
      return failed(reply, error);
    }
  });

  // An item's history, newest first, and the batches on the shelf.
  fastify.get('/inventory/:id/history', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const existing = await prisma.medicine.findUnique({ where: { id: (request.params as { id: string }).id } });
      if (!existing) return reply.status(404).send({ error: 'Medicine not found' });
      if (!assertClinicMatch(request, reply, existing.clinicId)) return;
      const [movements, batches] = await Promise.all([
        prisma.stockMovement.findMany({ where: { medicineId: existing.id }, orderBy: { createdAt: 'desc' }, take: 300 }),
        prisma.medicineBatch.findMany({ where: { medicineId: existing.id, quantity: { gt: 0 } }, orderBy: { expiryDate: 'asc' } }),
      ]);
      const userIds = [...new Set(movements.map((m) => m.userId).filter((id): id is string => !!id))];
      const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
      const nameOf = new Map(users.map((u) => [u.id, u.name]));
      const now = new Date();
      return {
        success: true,
        medicine: existing,
        batches: batches.map((b) => ({ id: b.id, quantity: b.quantity, expiryDate: b.expiryDate, receivedAt: b.receivedAt, supplier: b.supplier, reference: b.reference, expired: isExpired(b, now) })),
        movements: movements.map((m) => ({
          id: m.id, kind: m.kind, label: MOVEMENT_LABELS[m.kind], change: m.change, balanceAfter: m.balanceAfter,
          reason: m.reason, reasonLabel: m.reason ? REMOVAL_REASONS[m.reason as keyof typeof REMOVAL_REASONS] ?? m.reason : null,
          note: m.note, supplier: m.supplier, reference: m.reference, expiryDate: m.expiryDate, unitCost: m.unitCost,
          prescriptionId: m.prescriptionId, invoiceItemId: m.invoiceItemId, by: m.userId ? nameOf.get(m.userId) ?? null : null, at: m.createdAt,
        })),
      };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // Take a discontinued item off the active list. Its history is kept.
  fastify.delete('/inventory/:id', stockKeepers, async (request, reply) => {
    const authUser = getAuthUser(request);
    try {
      const existing = await stockItem(request, reply);
      if (!existing) return;
      const medicine = await inStockTransaction((tx) => discontinueStockItem(tx, {
        medicineId: existing.id, note: cleanText((request.body as any)?.note, 200), clinicId: existing.clinicId, userId: authUser.userId,
      }));
      await recordAudit({ entity: 'Medicine', recordId: medicine.id, clinicId: medicine.clinicId, action: 'DELETE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { name: medicine.name, quantityOnShelf: medicine.quantity } });
      return { success: true, medicine };
    } catch (error: any) {
      return failed(reply, error);
    }
  });
}
