import type { Medicine, MedicineBatch, Prisma, StockMovementKind } from '@prisma/client';
import { prisma } from './prisma';
import { cleanText } from './invoices';

/**
 * Stock control. What is on the shelf changes only here, and every change is
 * written down as a StockMovement - who, when, how many, why and the balance
 * afterwards - so a facility can always account for its medicines.
 *
 * Stock is held in batches, each with its own expiry date. Dispensing and
 * sales take from the batch that expires first and never from an expired one.
 * Each change locks the medicine for the length of its transaction, so two
 * people dispensing, receiving or counting at once never lose each other's work.
 */

type Tx = Prisma.TransactionClient;

/** Who may change stock: receive, remove, count, add or discontinue items. */
export const STOCK_ROLES = ['ADMIN', 'PHARMACIST'] as const;

export const REMOVAL_REASONS = {
  DAMAGED: 'Damaged',
  EXPIRED: 'Expired',
  LOST: 'Lost or missing',
  RETURNED: 'Returned to the supplier',
  OTHER: 'Other',
} as const;
export type RemovalReason = keyof typeof REMOVAL_REASONS;
export const isRemovalReason = (value: unknown): value is RemovalReason => typeof value === 'string' && value in REMOVAL_REASONS;

export const MOVEMENT_LABELS: Record<StockMovementKind, string> = {
  OPENING: 'Opening stock',
  RECEIVED: 'Received',
  DISPENSED: 'Dispensed',
  DISPENSE_REVERSED: 'Dispensing undone',
  SOLD: 'Sold over the counter',
  SALE_REVERSED: 'Sale taken off the bill',
  REMOVED: 'Removed',
  COUNTED: 'Counted',
  DISCONTINUED: 'Discontinued',
};

export const MAX_STOCK_QUANTITY = 10_000_000;

export class StockError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

type Allocation = { batchId: string; quantity: number };
type Actor = { userId: string | null; clinicId: string };

/** Locks a medicine row until the transaction ends. */
async function lockMedicine(tx: Tx, medicineId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Medicine" WHERE "id" = ${medicineId} FOR UPDATE`;
}

/** Soonest expiry first; stock without an expiry date last; then oldest delivery. */
function firstToExpire(a: MedicineBatch, b: MedicineBatch) {
  const ax = a.expiryDate?.getTime() ?? Number.POSITIVE_INFINITY;
  const bx = b.expiryDate?.getTime() ?? Number.POSITIVE_INFINITY;
  return ax - bx || a.receivedAt.getTime() - b.receivedAt.getTime();
}

export const isExpired = (batch: Pick<MedicineBatch, 'expiryDate'>, now: Date) => !!batch.expiryDate && batch.expiryDate.getTime() <= now.getTime();

/**
 * Locks the medicine and returns it with its batches holding stock. Stock that
 * reached the shelf without going through here (recorded before batches were
 * kept) is brought into step: what is not in a batch yet becomes one, with
 * the medicine's own expiry date.
 */
async function openStock(tx: Tx, medicineId: string, clinicId: string, { discontinuedToo = false } = {}) {
  await lockMedicine(tx, medicineId);
  const medicine = await tx.medicine.findFirst({ where: { id: medicineId, clinicId, ...(discontinuedToo ? {} : { deletedAt: null }) } });
  if (!medicine) return null;
  let batches = await tx.medicineBatch.findMany({ where: { medicineId, quantity: { gt: 0 } } });
  const inBatches = batches.reduce((sum, b) => sum + b.quantity, 0);
  if (medicine.quantity > inBatches) {
    await tx.medicineBatch.create({
      data: { medicineId, clinicId: medicine.clinicId, quantity: medicine.quantity - inBatches, expiryDate: medicine.expiryDate, receivedAt: medicine.createdAt },
    });
    batches = await tx.medicineBatch.findMany({ where: { medicineId, quantity: { gt: 0 } } });
  } else if (medicine.quantity < inBatches) {
    // Take the difference from the latest-expiring batches.
    let surplus = inBatches - medicine.quantity;
    for (const batch of [...batches].sort(firstToExpire).reverse()) {
      if (surplus <= 0) break;
      const take = Math.min(batch.quantity, surplus);
      await tx.medicineBatch.update({ where: { id: batch.id }, data: { quantity: { decrement: take } } });
      surplus -= take;
    }
    batches = await tx.medicineBatch.findMany({ where: { medicineId, quantity: { gt: 0 } } });
  }
  return { medicine, batches: batches.sort(firstToExpire) };
}

/** Writes the new balance (and soonest expiry) on the medicine and records the movement. */
async function settle(
  tx: Tx, medicine: Medicine, change: number,
  movement: Omit<Prisma.StockMovementUncheckedCreateInput, 'clinicId' | 'medicineId' | 'change' | 'balanceAfter'>,
) {
  const remaining = await tx.medicineBatch.findMany({ where: { medicineId: medicine.id, quantity: { gt: 0 } } });
  const quantity = remaining.reduce((sum, b) => sum + b.quantity, 0);
  const soonest = remaining.filter((b) => b.expiryDate).sort(firstToExpire)[0]?.expiryDate ?? null;
  const updated = await tx.medicine.update({ where: { id: medicine.id }, data: { quantity, expiryDate: soonest } });
  await tx.stockMovement.create({
    data: { ...movement, clinicId: medicine.clinicId, medicineId: medicine.id, change, balanceAfter: quantity },
  });
  return { medicine: updated, previousQuantity: medicine.quantity };
}

/** Takes `quantity` from the given batches in order; returns where it came from. */
async function takeFrom(tx: Tx, batches: MedicineBatch[], quantity: number): Promise<Allocation[]> {
  const allocations: Allocation[] = [];
  let left = quantity;
  for (const batch of batches) {
    if (left <= 0) break;
    const take = Math.min(batch.quantity, left);
    if (take <= 0) continue;
    await tx.medicineBatch.update({ where: { id: batch.id }, data: { quantity: { decrement: take } } });
    allocations.push({ batchId: batch.id, quantity: take });
    left -= take;
  }
  return allocations;
}

/** Puts stock back into the batches it came from (or, when not known, the latest-expiring one). */
async function putBack(tx: Tx, medicine: Medicine, quantity: number, allocations: Allocation[] | null): Promise<Allocation[]> {
  if (allocations?.length) {
    for (const a of allocations) await tx.medicineBatch.update({ where: { id: a.batchId }, data: { quantity: { increment: a.quantity } } });
    return allocations;
  }
  const all = await tx.medicineBatch.findMany({ where: { medicineId: medicine.id } });
  const latest = all.sort(firstToExpire).at(-1);
  const batch = latest
    ? await tx.medicineBatch.update({ where: { id: latest.id }, data: { quantity: { increment: quantity } } })
    : await tx.medicineBatch.create({ data: { medicineId: medicine.id, clinicId: medicine.clinicId, quantity, expiryDate: medicine.expiryDate } });
  return [{ batchId: batch.id, quantity }];
}

const allocationsOf = (value: Prisma.JsonValue | null | undefined): Allocation[] | null =>
  Array.isArray(value) ? (value as unknown as Allocation[]).filter((a) => a && typeof a.batchId === 'string' && Number.isInteger(a.quantity)) : null;

/**
 * Takes medicine off the shelf for a patient - dispensed against a prescription
 * or sold over the counter - from the batch that expires first. Refuses when
 * there is not enough in-date stock, saying how much has expired. Returns null
 * when the medicine is not (or no longer) a stock item: nothing to take.
 */
export async function takeStock(
  tx: Tx,
  input: { medicineId: string; quantity: number; kind: 'DISPENSED' | 'SOLD'; prescriptionId?: string | null; invoiceItemId?: string | null; now?: Date } & Actor,
) {
  const now = input.now ?? new Date();
  const open = await openStock(tx, input.medicineId, input.clinicId);
  if (!open) return null;
  const { medicine, batches } = open;
  const usable = batches.filter((b) => !isExpired(b, now));
  const inDate = usable.reduce((sum, b) => sum + b.quantity, 0);
  if (inDate < input.quantity) {
    const expired = medicine.quantity - inDate;
    if (medicine.quantity >= input.quantity && expired > 0) {
      throw new StockError(409, `Not enough ${medicine.name} in date: ${inDate} ${medicine.unit} can be used, ${input.quantity} needed - ${expired} ${medicine.unit} have expired. Remove the expired stock under Inventory.`);
    }
    throw new StockError(409, `Not enough ${medicine.name} in stock: ${inDate} ${medicine.unit} available, ${input.quantity} needed`);
  }
  const allocations = await takeFrom(tx, usable, input.quantity);
  return settle(tx, medicine, -input.quantity, {
    kind: input.kind, batches: allocations, prescriptionId: input.prescriptionId ?? null, invoiceItemId: input.invoiceItemId ?? null, userId: input.userId,
  });
}

/** Undoes a dispense or a sale: the stock goes back into the batches it came from. */
export async function returnStock(
  tx: Tx,
  input: { medicineId: string; quantity: number; kind: 'DISPENSE_REVERSED' | 'SALE_REVERSED'; prescriptionId?: string | null; invoiceItemId?: string | null } & Actor,
) {
  // Only stock this facility holds - and a medicine since discontinued still takes its stock back.
  const open = await openStock(tx, input.medicineId, input.clinicId, { discontinuedToo: true });
  if (!open) return null;
  const { medicine } = open;
  const taken = await tx.stockMovement.findFirst({
    where: input.prescriptionId ? { prescriptionId: input.prescriptionId, kind: 'DISPENSED' } : { invoiceItemId: input.invoiceItemId ?? '', kind: 'SOLD' },
    orderBy: { createdAt: 'desc' },
  });
  const allocations = await putBack(tx, medicine, input.quantity, allocationsOf(taken?.batches));
  return settle(tx, medicine, input.quantity, {
    kind: input.kind, batches: allocations, prescriptionId: input.prescriptionId ?? null, invoiceItemId: input.invoiceItemId ?? null, userId: input.userId,
  });
}

/** A delivery: a new batch with its own expiry date. */
export async function receiveStock(
  tx: Tx,
  input: { medicineId: string; quantity: number; expiryDate: Date | null; supplier: string | null; reference: string | null; unitCost: number | null; note: string | null } & Actor,
) {
  const open = await openStock(tx, input.medicineId, input.clinicId);
  if (!open) throw new StockError(404, 'Medicine not found');
  const batch = await tx.medicineBatch.create({
    data: { medicineId: open.medicine.id, clinicId: open.medicine.clinicId, quantity: input.quantity, expiryDate: input.expiryDate, supplier: input.supplier, reference: input.reference },
  });
  return settle(tx, open.medicine, input.quantity, {
    kind: 'RECEIVED', batches: [{ batchId: batch.id, quantity: input.quantity }], expiryDate: input.expiryDate,
    supplier: input.supplier, reference: input.reference, unitCost: input.unitCost, note: input.note, userId: input.userId,
  });
}

/**
 * Stock taken off the shelf for a reason - damaged, expired, lost, returned.
 * Expired stock comes out of the expired batches first; anything else from
 * the batch that expires first.
 */
export async function removeStock(
  tx: Tx,
  input: { medicineId: string; quantity: number; reason: RemovalReason; note: string | null; now?: Date } & Actor,
) {
  const now = input.now ?? new Date();
  const open = await openStock(tx, input.medicineId, input.clinicId);
  if (!open) throw new StockError(404, 'Medicine not found');
  const { medicine, batches } = open;
  if (input.quantity > medicine.quantity) {
    throw new StockError(400, `Only ${medicine.quantity} ${medicine.unit} of ${medicine.name} are on the shelf`);
  }
  const order = input.reason === 'EXPIRED'
    ? [...batches.filter((b) => isExpired(b, now)), ...batches.filter((b) => !isExpired(b, now))]
    : batches;
  const allocations = await takeFrom(tx, order, input.quantity);
  return settle(tx, medicine, -input.quantity, { kind: 'REMOVED', reason: input.reason, note: input.note, batches: allocations, userId: input.userId });
}

/**
 * A stock count: what is actually on the shelf. The difference is recorded
 * as such (with the note saying why); a count that matches is recorded too.
 */
export async function countStock(tx: Tx, input: { medicineId: string; counted: number; note: string | null } & Actor) {
  const open = await openStock(tx, input.medicineId, input.clinicId);
  if (!open) throw new StockError(404, 'Medicine not found');
  const { medicine, batches } = open;
  const difference = input.counted - medicine.quantity;
  if (difference !== 0 && !input.note) throw new StockError(400, 'Say why the count differs (for example: miscounted earlier, found more in the store)');
  let allocations: Allocation[] = [];
  if (difference < 0) allocations = await takeFrom(tx, batches, -difference);
  if (difference > 0) allocations = await putBack(tx, medicine, difference, null);
  return settle(tx, medicine, difference, { kind: 'COUNTED', note: input.note, batches: allocations, userId: input.userId });
}

/** A new stock item, with whatever is on the shelf as its opening stock. */
export async function createStockItem(
  tx: Tx,
  input: { id?: string; name: string; unit: string; reorderLevel: number; price: number; quantity: number; expiryDate: Date | null; createdAt?: Date } & Actor,
) {
  const medicine = await tx.medicine.create({
    data: {
      ...(input.id ? { id: input.id } : {}), clinicId: input.clinicId, name: input.name, unit: input.unit, reorderLevel: input.reorderLevel,
      price: input.price, quantity: 0, expiryDate: null, ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
  });
  const batches = input.quantity > 0
    ? [{ batchId: (await tx.medicineBatch.create({ data: { medicineId: medicine.id, clinicId: input.clinicId, quantity: input.quantity, expiryDate: input.expiryDate } })).id, quantity: input.quantity }]
    : [];
  return (await settle(tx, medicine, input.quantity, { kind: 'OPENING', batches, expiryDate: input.expiryDate, userId: input.userId })).medicine;
}

/** Taken off the active list. Its history stays; what was on the shelf is noted. */
export async function discontinueStockItem(tx: Tx, input: { medicineId: string; note: string | null } & Actor) {
  await lockMedicine(tx, input.medicineId);
  const medicine = await tx.medicine.findFirst({ where: { id: input.medicineId, clinicId: input.clinicId, deletedAt: null } });
  if (!medicine) throw new StockError(404, 'Medicine not found');
  await tx.stockMovement.create({
    data: { clinicId: medicine.clinicId, medicineId: medicine.id, kind: 'DISCONTINUED', change: 0, balanceAfter: medicine.quantity, note: input.note, userId: input.userId },
  });
  return tx.medicine.update({ where: { id: medicine.id }, data: { deletedAt: new Date() } });
}

/** Runs a stock change in its own transaction. */
export const inStockTransaction = <T>(fn: (tx: Tx) => Promise<T>) => prisma.$transaction(fn);

// --- Reading what a form sent ----------------------------------------------------

const wholeNumber = (value: unknown, { min, label }: { min: number; label: string }): number => {
  const n = typeof value === 'string' ? Number(value.replace(/[,\s]/g, '')) : Number(value);
  if (value === '' || value === null || value === undefined || !Number.isInteger(n) || n < min || n > MAX_STOCK_QUANTITY) {
    throw new StockError(400, `${label} must be a whole number${min > 0 ? `, ${min} or more` : ', 0 or more'}`);
  }
  return n;
};
export const parseQuantity = (value: unknown, label = 'The quantity') => wholeNumber(value, { min: 1, label });
export const parseCount = (value: unknown, label = 'The count') => wholeNumber(value, { min: 0, label });

export function parsePrice(value: unknown): number {
  const n = typeof value === 'string' ? Number(value.replace(/[,\s]/g, '')) : Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(n) || n < 0 || n > 100_000_000) {
    throw new StockError(400, 'The price must be 0 or more, in shillings');
  }
  return Math.round(n);
}

export function parseExpiry(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new StockError(400, 'The expiry date is not a date');
  return date;
}

/** The details of a stock item from a form; `partial` for an edit (only what was sent). */
export function parseItemDetails(body: any, partial = false) {
  const out: { name?: string; unit?: string; reorderLevel?: number; price?: number } = {};
  if (!partial || body?.name !== undefined) {
    const name = cleanText(body?.name, 120);
    if (!name) throw new StockError(400, 'Enter the name of the medicine or item');
    out.name = name;
  }
  if (!partial || body?.unit !== undefined) {
    const unit = cleanText(body?.unit, 30);
    if (!unit) throw new StockError(400, 'Enter the unit it is counted in (tablets, bottles...)');
    out.unit = unit;
  }
  if (!partial || body?.reorderLevel !== undefined) out.reorderLevel = parseCount(body?.reorderLevel ?? 0, 'The reorder level');
  if (!partial || body?.price !== undefined) out.price = parsePrice(body?.price ?? 0);
  return out;
}
