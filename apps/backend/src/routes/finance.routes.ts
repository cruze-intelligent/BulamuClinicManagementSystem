import { FastifyInstance } from 'fastify';
import type { PaymentMethod } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { resolveClinicScope, assertClinicMatch, getAuthUser } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { recordAudit } from '../lib/audit';
import {
  BILLING_ROLES, CHARGE_KINDS, EXPENSE_CATEGORIES, PAYMENT_METHODS, cleanText, eatDateKey, eatDayRange, eatMonthRange,
  formatReceiptNumber, isExpenseCategory, isPaymentMethod, parseAmount,
} from '../lib/invoices';
import { roleTitle } from '../lib/document-signer';
import { buildCsv, sendCsv } from '../lib/csv';
import { sendRouteError } from '../lib/http-error';

/** Payments with no method recorded (taken before methods were kept) are grouped under this key. */
const NOT_RECORDED = 'NOT_RECORDED';
const methodLabel = (method: PaymentMethod | null) => (method ? PAYMENT_METHODS[method] : 'Not recorded');

type Money = { method: PaymentMethod | null; amount: number };

/** Totals per payment method, in a fixed order (cash first), leaving out methods with nothing. */
function byMethod(rows: Money[]) {
  const keys = [...Object.keys(PAYMENT_METHODS), NOT_RECORDED];
  return keys
    .map((key) => {
      const matching = rows.filter((r) => (r.method ?? NOT_RECORDED) === key);
      return { method: key, label: key === NOT_RECORDED ? 'Not recorded' : PAYMENT_METHODS[key as PaymentMethod], total: matching.reduce((s, r) => s + r.amount, 0), count: matching.length };
    })
    .filter((m) => m.count > 0);
}

// A facility's own money: what it took in from patients, day by day and month by
// month, and what it paid out. Bulamu keeps the record; the money is the facility's.
export async function financeRoutes(fastify: FastifyInstance) {
  const billing = { preHandler: [requireRole(...BILLING_ROLES, 'SUPER_ADMIN')] };
  const managers = { preHandler: [requireRole('ADMIN', 'SUPER_ADMIN')] };

  // One day's takings (?date=YYYY-MM-DD, East Africa Time; today by default):
  // totals by method and by member of staff, every receipt, and voided ones
  // apart. Staff see the money they took themselves - for handing over at the
  // end of a shift; an administrator sees everyone's, and the day's spending.
  fastify.get('/finances/:clinicId/takings', billing, async (request, reply) => {
    const clinicId = resolveClinicScope(request, reply, (request.params as any).clinicId);
    if (!clinicId) return;
    const authUser = getAuthUser(request);
    const everyone = authUser.role === 'ADMIN' || authUser.role === 'SUPER_ADMIN';
    const { day, start, end } = eatDayRange((request.query as any).date);

    try {
      const [payments, expenses] = await Promise.all([
        prisma.patientPayment.findMany({
          where: { clinicId, receivedAt: { gte: start, lt: end }, ...(everyone ? {} : { receivedByUserId: authUser.userId }) },
          include: {
            receivedBy: { select: { id: true, name: true, role: true } },
            invoice: { select: { id: true, patient: { select: { name: true } } } },
          },
          orderBy: [{ receivedAt: 'asc' }, { receiptNumber: 'asc' }],
        }),
        everyone
          ? prisma.expense.findMany({ where: { clinicId, voidedAt: null, spentOn: { gte: start, lt: end } }, select: { amount: true, method: true } })
          : Promise.resolve([]),
      ]);
      const standing = payments.filter((p) => !p.voidedAt);
      const staff = new Map<string, { userId: string | null; name: string; role: string; rows: Money[] }>();
      for (const p of standing) {
        const key = p.receivedByUserId ?? 'unknown';
        const entry = staff.get(key) ?? { userId: p.receivedByUserId, name: p.receivedBy?.name ?? 'Not recorded', role: p.receivedBy ? roleTitle(p.receivedBy.role) : '', rows: [] };
        entry.rows.push(p);
        staff.set(key, entry);
      }
      const total = standing.reduce((s, p) => s + p.amount, 0);
      const cashIn = standing.filter((p) => p.method === 'CASH').reduce((s, p) => s + p.amount, 0);
      const cashOut = expenses.filter((e) => e.method === 'CASH').reduce((s, e) => s + e.amount, 0);
      return {
        success: true,
        takings: {
          date: day,
          scope: everyone ? 'everyone' : 'mine',
          total,
          count: standing.length,
          byMethod: byMethod(standing),
          byStaff: [...staff.values()]
            .map((s) => ({ userId: s.userId, name: s.name, role: s.role, total: s.rows.reduce((a, r) => a + r.amount, 0), count: s.rows.length, byMethod: byMethod(s.rows) }))
            .sort((a, b) => b.total - a.total),
          // Cash expected in the drawer: cash taken less cash paid out the same day.
          ...(everyone ? { expenses: expenses.reduce((s, e) => s + e.amount, 0), cashInHand: cashIn - cashOut } : {}),
          payments: payments.map((p) => ({
            id: p.id,
            receiptNumber: formatReceiptNumber(p.receiptNumber),
            receivedAt: p.receivedAt,
            amount: p.amount,
            method: p.method,
            methodLabel: methodLabel(p.method),
            reference: p.reference,
            patientName: p.invoice.patient.name,
            invoiceId: p.invoice.id,
            receivedBy: p.receivedBy?.name ?? null,
            voidedAt: p.voidedAt,
            voidReason: p.voidReason,
          })),
        },
      };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // A month at a glance (?month=YYYY-MM, this month by default): money received
  // (by method and by day), what was billed (by kind of charge), what was paid
  // out (by category), what is left, and everything still owed today.
  fastify.get('/finances/:clinicId/summary', managers, async (request, reply) => {
    const clinicId = resolveClinicScope(request, reply, (request.params as any).clinicId);
    if (!clinicId) return;
    const { month, start, end, days } = eatMonthRange((request.query as any).month);

    try {
      const [payments, billed, expenses, open, previous] = await Promise.all([
        prisma.patientPayment.findMany({ where: { clinicId, voidedAt: null, receivedAt: { gte: start, lt: end } }, select: { amount: true, method: true, receivedAt: true } }),
        prisma.invoiceItem.groupBy({
          by: ['kind'],
          where: { createdAt: { gte: start, lt: end }, invoice: { clinicId, status: { not: 'CANCELLED' } } },
          _sum: { amount: true },
          _count: true,
        }),
        prisma.expense.groupBy({ by: ['category'], where: { clinicId, voidedAt: null, spentOn: { gte: start, lt: end } }, _sum: { amount: true }, _count: true }),
        prisma.invoice.aggregate({ where: { clinicId, status: 'PENDING' }, _sum: { amount: true, amountPaid: true }, _count: true }),
        prisma.patientPayment.aggregate({
          where: { clinicId, voidedAt: null, receivedAt: { gte: eatMonthRange(previousMonth(month)).start, lt: start } },
          _sum: { amount: true },
        }),
      ]);
      const income = payments.reduce((s, p) => s + p.amount, 0);
      const spent = expenses.reduce((s, e) => s + (e._sum.amount ?? 0), 0);
      const perDay = new Map(days.map((d) => [d, 0]));
      for (const p of payments) {
        const key = eatDateKey(p.receivedAt);
        perDay.set(key, (perDay.get(key) ?? 0) + p.amount);
      }
      return {
        success: true,
        summary: {
          month,
          income,
          previousIncome: previous._sum.amount ?? 0,
          payments: payments.length,
          byMethod: byMethod(payments),
          byDay: [...perDay.entries()].map(([date, total]) => ({ date, total })),
          billed: billed
            .map((b) => ({ kind: b.kind, label: CHARGE_KINDS[b.kind], total: b._sum.amount ?? 0, count: b._count }))
            .sort((a, b) => b.total - a.total),
          expenses: spent,
          expensesByCategory: expenses
            .map((e) => ({ category: e.category, label: EXPENSE_CATEGORIES[e.category], total: e._sum.amount ?? 0, count: e._count }))
            .sort((a, b) => b.total - a.total),
          net: income - spent,
          outstanding: (open._sum.amount ?? 0) - (open._sum.amountPaid ?? 0),
          outstandingCount: open._count,
        },
      };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // The month's money in and out as a spreadsheet, for the facility's books or accountant.
  fastify.get('/finances/:clinicId/export', managers, async (request, reply) => {
    const clinicId = resolveClinicScope(request, reply, (request.params as any).clinicId);
    if (!clinicId) return;
    const { month, start, end } = eatMonthRange((request.query as any).month);
    try {
      const [payments, expenses] = await Promise.all([
        prisma.patientPayment.findMany({
          where: { clinicId, receivedAt: { gte: start, lt: end } },
          include: { receivedBy: { select: { name: true } }, invoice: { select: { patient: { select: { name: true } } } } },
          orderBy: [{ receivedAt: 'asc' }, { receiptNumber: 'asc' }],
        }),
        prisma.expense.findMany({ where: { clinicId, spentOn: { gte: start, lt: end } }, include: { recordedBy: { select: { name: true } } }, orderBy: { spentOn: 'asc' } }),
      ]);
      type Row = { type: string; date: string; ref: string; who: string; detail: string; method: string; amount: number; by: string; status: string };
      const rows: Row[] = [
        ...payments.map((p) => ({
          type: 'Money in', date: eatDateKey(p.receivedAt), ref: `Receipt ${formatReceiptNumber(p.receiptNumber)}`, who: p.payerName || p.invoice.patient.name,
          detail: p.reference ?? '', method: methodLabel(p.method), amount: p.amount, by: p.receivedBy?.name ?? '', status: p.voidedAt ? `Void: ${p.voidReason ?? ''}` : '',
        })),
        ...expenses.map((e) => ({
          type: 'Money out', date: eatDateKey(e.spentOn), ref: e.reference ?? '', who: e.paidTo ?? '', detail: `${EXPENSE_CATEGORIES[e.category]} - ${e.description}`,
          method: methodLabel(e.method), amount: -e.amount, by: e.recordedBy?.name ?? '', status: e.voidedAt ? `Void: ${e.voidReason ?? ''}` : '',
        })),
      ].sort((a, b) => a.date.localeCompare(b.date));
      const csv = buildCsv<Row>([
        ['Type', (r) => r.type], ['Date', (r) => r.date], ['Receipt / reference', (r) => r.ref], ['Received from / paid to', (r) => r.who],
        ['Details', (r) => r.detail], ['Method', (r) => r.method], ['Amount (UGX)', (r) => r.amount], ['Recorded by', (r) => r.by], ['Status', (r) => r.status],
      ], rows);
      return sendCsv(reply, `finances-${month}.csv`, csv);
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // The month's expenses (?month=YYYY-MM), voided ones included and marked.
  fastify.get('/expenses/:clinicId', managers, async (request, reply) => {
    const clinicId = resolveClinicScope(request, reply, (request.params as any).clinicId);
    if (!clinicId) return;
    const { month, start, end } = eatMonthRange((request.query as any).month);
    try {
      const expenses = await prisma.expense.findMany({
        where: { clinicId, spentOn: { gte: start, lt: end } },
        include: { recordedBy: { select: { name: true } } },
        orderBy: [{ spentOn: 'desc' }, { createdAt: 'desc' }],
      });
      return { success: true, month, expenses };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // Record money paid out.
  fastify.post('/expenses', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const body = (request.body ?? {}) as any;
    const authUser = getAuthUser(request);
    if (!isExpenseCategory(body.category)) return reply.status(400).send({ error: 'Choose what the money was spent on' });
    const description = cleanText(body.description, 160);
    if (!description) return reply.status(400).send({ error: 'Describe the expense' });
    let amount: number;
    try {
      amount = parseAmount(body.amount);
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
    }
    if (body.method && (!isPaymentMethod(body.method) || body.method === 'INSURANCE')) return reply.status(400).send({ error: 'Choose how it was paid' });
    const today = eatDayRange();
    const { start: spentOn, day } = eatDayRange(body.spentOn ?? today.day);
    if (typeof body.spentOn === 'string' && body.spentOn && day !== body.spentOn) return reply.status(400).send({ error: 'Enter the date it was paid' });
    if (spentOn > today.start) return reply.status(400).send({ error: "The date can't be in the future" });

    try {
      const expense = await prisma.expense.create({
        data: {
          clinicId: authUser.clinicId, category: body.category, description, amount, spentOn,
          method: body.method || null, paidTo: cleanText(body.paidTo, 80), reference: cleanText(body.reference, 80), recordedByUserId: authUser.userId,
        },
      });
      await recordAudit({
        entity: 'Expense', recordId: expense.id, clinicId: expense.clinicId, action: 'CREATE', actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { amount, category: expense.category },
      });
      return { success: true, expense };
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
    }
  });

  // Void an expense recorded by mistake - kept, marked void with the reason.
  fastify.post('/expenses/:id/void', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const { id } = request.params as any;
    const reason = cleanText((request.body as any)?.reason, 200);
    if (!reason || reason.length < 3) return reply.status(400).send({ error: 'Say why the expense is being voided' });
    const authUser = getAuthUser(request);
    try {
      const existing = await prisma.expense.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send({ error: 'Expense not found' });
      if (!assertClinicMatch(request, reply, existing.clinicId)) return;
      if (existing.voidedAt) return reply.status(409).send({ error: 'This expense is already void' });
      const expense = await prisma.expense.update({ where: { id }, data: { voidedAt: new Date(), voidedByUserId: authUser.userId, voidReason: reason } });
      await recordAudit({
        entity: 'Expense', recordId: id, clinicId: existing.clinicId, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { voided: true, amount: existing.amount },
      });
      return { success: true, expense };
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
    }
  });
}

/** "2026-09" for "2026-10". */
function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
