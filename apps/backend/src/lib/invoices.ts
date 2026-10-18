import type { ChargeKind, ExpenseCategory, PaymentMethod, Prisma } from '@prisma/client';

// Patient invoices are the facility's own bills to its patients. Bulamu keeps
// the record (what was charged, what was paid, by whom and how) - the facility
// charges and collects.

const MAX_FEE = 100_000_000; // UGX - far above any single visit; catches a mistyped extra zero or two.

/** A fee in whole UGX, or null if none was given. Throws on an impossible amount. */
export function parseFee(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const fee = typeof value === 'string' ? Number(value.replace(/[,\s]/g, '')) : Number(value);
  if (!Number.isFinite(fee) || !Number.isInteger(fee) || fee < 0) throw new Error('The fee must be a whole number of shillings');
  if (fee > MAX_FEE) throw new Error('That fee looks too large - check the amount');
  return fee === 0 ? null : fee;
}

/** An amount of money that must be given: whole shillings, more than zero. Throws with a message for the person typing it. */
export function parseAmount(value: unknown): number {
  if (value === undefined || value === null || value === '') throw new Error('Enter the amount');
  const amount = typeof value === 'string' ? Number(value.replace(/[,\s]/g, '')) : Number(value);
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) throw new Error('The amount must be a whole number of shillings, more than zero');
  if (amount > MAX_FEE) throw new Error('That amount looks too large - check it');
  return amount;
}

export const PAYMENT_METHODS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  MOBILE_MONEY: 'Mobile money',
  CARD: 'Card',
  BANK: 'Bank transfer',
  INSURANCE: 'Insurance',
};

export const CHARGE_KINDS: Record<ChargeKind, string> = {
  CONSULTATION: 'Consultation',
  LAB: 'Lab test',
  MEDICINE: 'Medicine',
  PROCEDURE: 'Procedure',
  ADMISSION: 'Admission / ward',
  OTHER: 'Other',
};

export const EXPENSE_CATEGORIES: Record<ExpenseCategory, string> = {
  MEDICINES_SUPPLIES: 'Medicines and supplies',
  SALARIES: 'Salaries and wages',
  RENT: 'Rent',
  UTILITIES: 'Utilities (power, water, internet)',
  EQUIPMENT: 'Equipment and repairs',
  TRANSPORT: 'Transport',
  OTHER: 'Other',
};

export const isPaymentMethod = (value: unknown): value is PaymentMethod => typeof value === 'string' && value in PAYMENT_METHODS;
export const isChargeKind = (value: unknown): value is ChargeKind => typeof value === 'string' && value in CHARGE_KINDS;
export const isExpenseCategory = (value: unknown): value is ExpenseCategory => typeof value === 'string' && value in EXPENSE_CATEGORIES;

/** Who handles money at the front desk, in the consulting room and at the pharmacy. */
export const BILLING_ROLES = ['ADMIN', 'DOCTOR', 'NURSE', 'STAFF', 'PHARMACIST'] as const;

/** Receipt numbers as printed: 000042. */
export function formatReceiptNumber(n: number): string {
  return String(n).padStart(6, '0');
}

/** Free text from a form: trimmed, at most `max` characters, or null when empty. */
export function cleanText(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, max) : null;
}

type Tx = Prisma.TransactionClient;

/**
 * Holds the bill until the transaction ends, so two people taking money for the
 * same bill at once (or one adding a charge while another takes payment) are
 * handled one after the other and the balance is never miscounted.
 */
export async function lockInvoice(tx: Tx, invoiceId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
}

/**
 * Brings a bill's totals and status in step with its items and the payments
 * that stand: paid in full when nothing is owed, unpaid otherwise. A cancelled
 * bill stays cancelled. A bill with no items at all (a lump sum from before
 * bills were itemised) keeps its amount.
 */
export async function settleInvoice(tx: Tx, invoiceId: string) {
  const [items, payments, invoice] = await Promise.all([
    tx.invoiceItem.aggregate({ where: { invoiceId }, _sum: { amount: true }, _count: true }),
    tx.patientPayment.aggregate({ where: { invoiceId, voidedAt: null }, _sum: { amount: true }, _max: { receivedAt: true } }),
    tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { status: true, amount: true } }),
  ]);
  const amount = items._count ? items._sum.amount ?? 0 : invoice.amount;
  const amountPaid = payments._sum.amount ?? 0;
  const paidInFull = amount > 0 && amountPaid >= amount;
  return tx.invoice.update({
    where: { id: invoiceId },
    data: {
      amount,
      amountPaid,
      ...(invoice.status === 'CANCELLED' ? {} : { status: paidInFull ? 'PAID' : 'PENDING' }),
      paidAt: paidInFull ? payments._max.receivedAt : null,
    },
  });
}

/**
 * A bill from before itemising is one lump sum with no lines; before it gets a
 * line of its own, that sum becomes its first line, so nothing already charged
 * is lost from the total.
 */
export async function ensureItemised(tx: Tx, invoice: { id: string; amount: number; createdAt: Date; createdByUserId?: string | null }) {
  if (invoice.amount <= 0) return;
  if (await tx.invoiceItem.count({ where: { invoiceId: invoice.id } })) return;
  const amount = Math.round(invoice.amount);
  await tx.invoiceItem.create({
    data: { invoiceId: invoice.id, kind: 'CONSULTATION', description: 'Consultation', quantity: 1, unitPrice: amount, amount, createdAt: invoice.createdAt, addedByUserId: invoice.createdByUserId ?? null },
  });
}

/** The balance still owed on a bill. */
export const balanceOf = (invoice: { amount: number; amountPaid: number; status: string }) =>
  invoice.status === 'CANCELLED' ? 0 : Math.max(0, invoice.amount - invoice.amountPaid);

// --- Days and months are East Africa Time (UTC+3, no daylight saving) ----------
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

/** "2026-10-18" for the EAT day an instant falls on. */
export function eatDateKey(date: Date): string {
  return new Date(date.getTime() + EAT_OFFSET_MS).toISOString().slice(0, 10);
}

/** The instants an EAT day (YYYY-MM-DD) starts and ends at; today when none or an invalid one is given. */
export function eatDayRange(day?: unknown): { day: string; start: Date; end: Date } {
  const key = typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) ? day : eatDateKey(new Date());
  const start = new Date(Date.parse(`${key}T00:00:00Z`) - EAT_OFFSET_MS);
  return { day: key, start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/** The instants an EAT month (YYYY-MM) starts and ends at; this month when none or an invalid one is given. */
export function eatMonthRange(month?: unknown): { month: string; start: Date; end: Date; days: string[] } {
  const valid = typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  const key = valid ? (month as string) : eatDateKey(new Date()).slice(0, 7);
  const [y, m] = key.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1) - EAT_OFFSET_MS);
  const end = new Date(Date.UTC(y, m, 1) - EAT_OFFSET_MS);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = Array.from({ length: count }, (_, i) => `${key}-${String(i + 1).padStart(2, '0')}`);
  return { month: key, start, end, days };
}
