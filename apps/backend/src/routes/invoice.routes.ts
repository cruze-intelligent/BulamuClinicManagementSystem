import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ChargeKind, Prisma } from '@prisma/client';
import { prisma, isUniqueConstraintError } from '../lib/prisma';
import { resolveClinicScope, assertClinicMatch, getAuthUser } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { recordAudit } from '../lib/audit';
import { generateInvoicePdf, generatePatientReceiptPdf, billState, type BillLine } from '../lib/pdf';
import {
  BILLING_ROLES, CHARGE_KINDS, PAYMENT_METHODS, balanceOf, cleanText, ensureItemised, formatReceiptNumber, isChargeKind,
  isPaymentMethod, lockInvoice, parseAmount, parseFee, settleInvoice,
} from '../lib/invoices';
import { facilityLogo } from '../lib/facility-logo';
import { documentProducer, signer, type Signer } from '../lib/document-signer';
import { sendMail, patientReceiptEmail } from '../lib/mailer';
import { sendRouteError } from '../lib/http-error';

const MAX_QUANTITY = 10_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Everything a bill screen shows: patient, visit, lines and payments (with who took each). */
const INVOICE_INCLUDE = {
  patient: { select: { id: true, name: true, phone: true, email: true } },
  consultation: {
    select: { id: true, diagnosis: true, createdAt: true, appointment: { select: { doctor: { select: { name: true } } } } },
  },
  items: { orderBy: { createdAt: 'asc' } },
  payments: {
    orderBy: [{ receivedAt: 'asc' }, { receiptNumber: 'asc' }],
    include: { receivedBy: { select: { name: true, role: true } }, voidedBy: { select: { name: true } } },
  },
} satisfies Prisma.InvoiceInclude;

type FullInvoice = Prisma.InvoiceGetPayload<{ include: typeof INVOICE_INCLUDE }>;

const ugx = (amount: number) => `UGX ${Math.round(amount).toLocaleString('en-US')}`;

/** A bill as the app shows it: its state in words, the balance, and receipt numbers as printed. */
function present(invoice: FullInvoice) {
  return {
    ...invoice,
    state: billState(invoice),
    balance: balanceOf(invoice),
    payments: invoice.payments.map((p) => ({ ...p, receiptNumber: formatReceiptNumber(p.receiptNumber) })),
  };
}

/** The bill's lines as printed; a lump-sum bill from before itemising is one consultation line. */
function billLines(invoice: FullInvoice): BillLine[] {
  if (invoice.items.length) {
    return invoice.items.map((i) => ({ description: i.description, kind: CHARGE_KINDS[i.kind], quantity: i.quantity, unitPrice: i.unitPrice, amount: i.amount }));
  }
  const label = invoice.consultation ? `Consultation - ${invoice.consultation.diagnosis}` : 'Consultation';
  return [{ description: label, quantity: 1, unitPrice: invoice.amount, amount: invoice.amount }];
}

type ChargeInput = { kind: ChargeKind; description: string; quantity: number; unitPrice: number; labTestId: string | null; prescriptionId: string | null; admissionId: string | null };

/** Reads one charge from a form. Throws with a message for the person typing it. */
function parseCharge(body: any): ChargeInput {
  const kind = body?.kind ?? 'OTHER';
  if (!isChargeKind(kind)) throw new Error('Choose what the charge is for');
  const description = cleanText(body?.description, 120);
  if (!description) throw new Error('Describe the charge');
  const quantity = body?.quantity === undefined || body?.quantity === '' ? 1 : Number(body.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) throw new Error('The quantity must be a whole number, 1 or more');
  const unitPrice = parseAmount(body?.unitPrice ?? body?.amount);
  if (unitPrice * quantity > 100_000_000) throw new Error('That charge looks too large - check the price and quantity');
  return {
    kind, description, quantity, unitPrice,
    labTestId: typeof body?.labTestId === 'string' && body.labTestId ? body.labTestId : null,
    prescriptionId: typeof body?.prescriptionId === 'string' && body.prescriptionId ? body.prescriptionId : null,
    admissionId: typeof body?.admissionId === 'string' && body.admissionId ? body.admissionId : null,
  };
}

/** A lab test, prescription or ward stay being billed must be this patient's. */
async function checkChargeLinks(charge: ChargeInput, patientId: string): Promise<string | null> {
  if (charge.labTestId) {
    const test = await prisma.labTest.findFirst({ where: { id: charge.labTestId, patientId, deletedAt: null }, select: { id: true } });
    if (!test) return "That lab test isn't this patient's";
  }
  if (charge.prescriptionId) {
    const rx = await prisma.prescription.findFirst({ where: { id: charge.prescriptionId, consultation: { patientId } }, select: { id: true } });
    if (!rx) return "That prescription isn't this patient's";
  }
  if (charge.admissionId) {
    const stay = await prisma.admission.findFirst({ where: { id: charge.admissionId, patientId }, select: { id: true } });
    if (!stay) return "That ward stay isn't this patient's";
  }
  return null;
}

const chargeData = (charge: ChargeInput, userId: string) => ({
  kind: charge.kind,
  description: charge.description,
  quantity: charge.quantity,
  unitPrice: charge.unitPrice,
  amount: charge.quantity * charge.unitPrice,
  labTestId: charge.labTestId,
  prescriptionId: charge.prescriptionId,
  admissionId: charge.admissionId,
  addedByUserId: userId,
});

async function loadInvoice(id: string) {
  return prisma.invoice.findUnique({ where: { id }, include: INVOICE_INCLUDE });
}

/**
 * What could still go on this bill, so every stage of the patient's care is
 * charged for: the visit's lab tests and prescribed medicines, the patient's lab
 * tests ordered outside a visit in the last month, and the nights of any ward
 * stay in the last two months not yet charged - each with a suggested price:
 * the stock price for a medicine, and for anything else the price last charged
 * for it here.
 */
async function chargeSuggestions(invoice: FullInvoice) {
  const DAY = 24 * 60 * 60 * 1000;
  const since = new Date(Date.now() - 30 * DAY);
  const [labTests, prescriptions, stays] = await Promise.all([
    prisma.labTest.findMany({
      where: {
        patientId: invoice.patientId, deletedAt: null, status: { not: 'CANCELLED' }, invoiceItem: null,
        OR: [
          ...(invoice.consultationId ? [{ consultationId: invoice.consultationId }] : []),
          { consultationId: null, createdAt: { gte: since } },
        ],
      },
      select: { id: true, testName: true },
      orderBy: { createdAt: 'asc' },
    }),
    invoice.consultationId
      ? prisma.prescription.findMany({
          where: { consultationId: invoice.consultationId, invoiceItem: null },
          select: { id: true, medication: true, strength: true, quantity: true, dispensedQuantity: true, medicine: { select: { price: true } } },
          orderBy: { createdAt: 'asc' },
        })
      : Promise.resolve([]),
    prisma.admission.findMany({
      where: { patientId: invoice.patientId, clinicId: invoice.clinicId, OR: [{ status: 'ADMITTED' }, { dischargedAt: { gte: new Date(Date.now() - 60 * DAY) } }] },
      select: { id: true, admittedAt: true, dischargedAt: true, ward: { select: { name: true } }, invoiceItems: { select: { quantity: true } } },
      orderBy: { admittedAt: 'asc' },
    }),
  ]);
  // Nights in the ward so far (a stay that started today counts as one), less any already charged.
  const unbilledStays = stays
    .map((stay) => {
      const nights = Math.max(1, Math.ceil(((stay.dischargedAt ?? new Date()).getTime() - stay.admittedAt.getTime()) / DAY));
      return { stay, nights: nights - stay.invoiceItems.reduce((sum, i) => sum + i.quantity, 0) };
    })
    .filter((s) => s.nights > 0);
  const describeStay = (ward: string) => `${ward} - ward stay (per night)`;
  const priced = [...labTests.map((t) => t.testName), ...unbilledStays.map((s) => describeStay(s.stay.ward.name))];
  const lastPrices = priced.length
    ? await prisma.invoiceItem.findMany({
        where: { kind: { in: ['LAB', 'ADMISSION'] }, description: { in: priced, mode: 'insensitive' }, invoice: { clinicId: invoice.clinicId } },
        orderBy: { createdAt: 'desc' },
        select: { description: true, unitPrice: true },
      })
    : [];
  const lastPrice = (name: string) => lastPrices.find((p) => p.description.toLowerCase() === name.toLowerCase())?.unitPrice ?? null;
  return [
    ...labTests.map((t) => ({ kind: 'LAB' as const, description: t.testName, quantity: 1, unitPrice: lastPrice(t.testName), labTestId: t.id })),
    ...prescriptions.map((rx) => ({
      kind: 'MEDICINE' as const,
      description: [rx.medication, rx.strength].filter(Boolean).join(' '),
      quantity: rx.dispensedQuantity ?? rx.quantity ?? 1,
      unitPrice: rx.medicine?.price ? Math.round(rx.medicine.price) : null,
      prescriptionId: rx.id,
    })),
    ...unbilledStays.map(({ stay, nights }) => ({
      kind: 'ADMISSION' as const,
      description: describeStay(stay.ward.name),
      quantity: nights,
      unitPrice: lastPrice(describeStay(stay.ward.name)),
      admissionId: stay.id,
    })),
  ];
}

// Patient invoices are each facility's own bills to its patients: the facility
// charges and collects the money, Bulamu only keeps the record.
/** A payment's receipt as a PDF - for staff, and for the patient in the Patient Portal. Callers check access first. */
export async function buildReceipt(id: string, producedBy: Signer | string | null) {
  const payment = await prisma.patientPayment.findUnique({
    where: { id },
    include: {
      receivedBy: { select: { name: true, role: true } },
      clinic: { select: { id: true, name: true, facilityCode: true, phone: true } },
    },
  });
  if (!payment) return null;
  const invoice = (await loadInvoice(payment.invoiceId))!;
  // Paid to date as it stood once this payment was taken (later payments not counted).
  const paidToDate = invoice.payments
    .filter((p) => !p.voidedAt && (p.receivedAt < payment.receivedAt || p.id === payment.id || (p.receivedAt.getTime() === payment.receivedAt.getTime() && p.receiptNumber <= payment.receiptNumber)))
    .reduce((sum, p) => sum + p.amount, 0);
  const pdf = await generatePatientReceiptPdf({
    receiptNumber: formatReceiptNumber(payment.receiptNumber),
    clinicName: payment.clinic.name,
    facilityCode: payment.clinic.facilityCode,
    clinicPhone: payment.clinic.phone,
    clinicLogo: await facilityLogo(payment.clinic.id),
    patientName: invoice.patient.name,
    patientPhone: invoice.patient.phone,
    payerName: payment.payerName,
    amount: payment.amount,
    method: payment.method ? PAYMENT_METHODS[payment.method] : 'Not recorded',
    reference: payment.reference,
    receivedAt: payment.receivedAt,
    receivedBy: signer(payment.receivedBy),
    invoiceId: invoice.id,
    billTotal: invoice.amount,
    paidToDate: payment.voidedAt ? paidToDate + payment.amount : paidToDate,
    items: billLines(invoice),
    voided: payment.voidedAt ? { at: payment.voidedAt, reason: payment.voidReason } : null,
    producedBy,
  });
  return { payment, invoice, pdf };
}

export async function invoiceRoutes(fastify: FastifyInstance) {
  const billing = { preHandler: [requireRole(...BILLING_ROLES, 'SUPER_ADMIN')] };
  const adminOnly = { preHandler: [requireRole('ADMIN')] };

  // The facility's bills, newest first. ?status= UNPAID, PART_PAID, PAID,
  // CANCELLED or OPEN (anything still owed); ?q= part of the patient's name.
  fastify.get('/invoices/:clinicId', billing, async (request, reply) => {
    const { clinicId: requestedClinicId } = request.params as any;
    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;
    const { status, q } = request.query as { status?: string; q?: string };

    const byStatus: Record<string, Prisma.InvoiceWhereInput> = {
      UNPAID: { status: 'PENDING', amountPaid: 0 },
      PENDING: { status: 'PENDING' },
      OPEN: { status: 'PENDING' },
      PART_PAID: { status: 'PENDING', amountPaid: { gt: 0 } },
      PAID: { status: 'PAID' },
      CANCELLED: { status: 'CANCELLED' },
    };
    const search = typeof q === 'string' ? q.trim() : '';
    try {
      const [invoices, open] = await Promise.all([
        prisma.invoice.findMany({
          where: {
            clinicId,
            ...(status && byStatus[status] ? byStatus[status] : {}),
            ...(search ? { patient: { name: { contains: search, mode: 'insensitive' } } } : {}),
          },
          include: INVOICE_INCLUDE,
          orderBy: { createdAt: 'desc' },
          take: 300,
        }),
        prisma.invoice.aggregate({ where: { clinicId, status: 'PENDING' }, _sum: { amount: true, amountPaid: true }, _count: true }),
      ]);
      return {
        success: true,
        invoices: invoices.map(present),
        summary: { outstanding: (open._sum.amount ?? 0) - (open._sum.amountPaid ?? 0), outstandingCount: open._count },
      };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // One bill in full, with what could still be added to it.
  fastify.get('/invoices/detail/:id', billing, async (request, reply) => {
    const { id } = request.params as any;
    try {
      const invoice = await loadInvoice(id);
      if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
      if (!assertClinicMatch(request, reply, invoice.clinicId)) return;
      return { success: true, invoice: present(invoice), suggestions: invoice.status === 'CANCELLED' ? [] : await chargeSuggestions(invoice) };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // Open a bill: for a visit ({ consultationId }) or for a patient without one
  // ({ patientId }, a walk-in), with its first charges. The older shape -
  // { consultationId, amount } - charges one consultation fee.
  fastify.post('/invoices', billing, async (request, reply) => {
    const body = (request.body ?? {}) as any;
    const authUser = getAuthUser(request);
    let charges: ChargeInput[];
    try {
      if (Array.isArray(body.items) && body.items.length) {
        charges = body.items.slice(0, 50).map(parseCharge);
      } else {
        const fee = parseFee(body.amount);
        if (!fee) return reply.status(400).send({ error: 'Enter the amount to charge' });
        charges = [{ kind: 'CONSULTATION', description: 'Consultation', quantity: 1, unitPrice: fee, labTestId: null, prescriptionId: null, admissionId: null }];
      }
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
    }

    try {
      let patientId: string;
      let clinicId: string;
      let consultationId: string | null = null;
      if (body.consultationId) {
        const consultation = await prisma.consultation.findUnique({
          where: { id: String(body.consultationId) },
          include: { appointment: { select: { clinicId: true } } },
        });
        if (!consultation || consultation.deletedAt) return reply.status(404).send({ error: 'Consultation not found' });
        if (!assertClinicMatch(request, reply, consultation.appointment.clinicId)) return;
        patientId = consultation.patientId;
        clinicId = consultation.appointment.clinicId;
        consultationId = consultation.id;
      } else {
        const patient = await prisma.patient.findFirst({ where: { id: String(body.patientId ?? ''), deletedAt: null } });
        if (!patient) return reply.status(404).send({ error: 'Patient not found' });
        if (!assertClinicMatch(request, reply, patient.clinicId)) return;
        patientId = patient.id;
        clinicId = patient.clinicId;
      }
      for (const charge of charges) {
        const problem = await checkChargeLinks(charge, patientId);
        if (problem) return reply.status(400).send({ error: problem });
      }

      const created = await prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.create({
          data: {
            consultationId, patientId, clinicId, createdByUserId: authUser.userId,
            amount: 0, items: { create: charges.map((c) => chargeData(c, authUser.userId)) },
          },
        });
        return settleInvoice(tx, invoice.id);
      });
      await recordAudit({
        entity: 'Invoice', recordId: created.id, clinicId,
        action: 'CREATE', actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { amount: created.amount, items: charges.length },
      });
      return { success: true, invoice: present((await loadInvoice(created.id))!) };
    } catch (error: any) {
      if (isUniqueConstraintError(error)) {
        return reply.status(409).send({ error: body.consultationId ? 'This consultation already has an invoice' : 'One of these is already on an invoice' });
      }
      return sendRouteError(reply, error, 400);
    }
  });

  // Add a charge to a bill (a lab test, medicine, procedure...). A bill that
  // was paid in full is open again until the new charge is paid.
  fastify.post('/invoices/:id/items', billing, async (request, reply) => {
    const { id } = request.params as any;
    const authUser = getAuthUser(request);
    let charge: ChargeInput;
    try {
      charge = parseCharge(request.body);
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
    }
    try {
      const existing = await prisma.invoice.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send({ error: 'Invoice not found' });
      if (!assertClinicMatch(request, reply, existing.clinicId)) return;
      if (existing.status === 'CANCELLED') return reply.status(409).send({ error: 'This invoice was cancelled - open a new one' });
      const problem = await checkChargeLinks(charge, existing.patientId);
      if (problem) return reply.status(400).send({ error: problem });

      await prisma.$transaction(async (tx) => {
        await lockInvoice(tx, id);
        await ensureItemised(tx, existing);
        await tx.invoiceItem.create({ data: { invoiceId: id, ...chargeData(charge, authUser.userId) } });
        await settleInvoice(tx, id);
      });
      await recordAudit({
        entity: 'Invoice', recordId: id, clinicId: existing.clinicId, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { added: charge.kind, amount: charge.quantity * charge.unitPrice },
      });
      return { success: true, invoice: present((await loadInvoice(id))!) };
    } catch (error: any) {
      if (isUniqueConstraintError(error)) return reply.status(409).send({ error: 'That is already on an invoice' });
      return sendRouteError(reply, error, 400);
    }
  });

  // Take a charge off a bill (added by mistake). Never below what has been paid:
  // a payment that covered it must be voided first.
  fastify.delete('/invoices/:id/items/:itemId', billing, async (request, reply) => {
    const { id, itemId } = request.params as any;
    const authUser = getAuthUser(request);
    try {
      const existing = await prisma.invoice.findUnique({ where: { id }, include: { items: { select: { id: true, amount: true, kind: true } } } });
      if (!existing) return reply.status(404).send({ error: 'Invoice not found' });
      if (!assertClinicMatch(request, reply, existing.clinicId)) return;
      const item = existing.items.find((i) => i.id === itemId);
      if (!item) return reply.status(404).send({ error: 'That charge is not on this invoice' });
      if (existing.status === 'CANCELLED') return reply.status(409).send({ error: 'This invoice was cancelled' });

      const outcome = await prisma.$transaction(async (tx) => {
        await lockInvoice(tx, id);
        const fresh = await tx.invoice.findUniqueOrThrow({ where: { id }, include: { _count: { select: { items: true } } } });
        if (fresh._count.items <= 1) return 'last';
        if (fresh.amount - item.amount < fresh.amountPaid) return 'paid';
        await tx.invoiceItem.delete({ where: { id: itemId } });
        await settleInvoice(tx, id);
        return 'ok';
      });
      if (outcome === 'last') return reply.status(409).send({ error: 'This is the only charge on the invoice - cancel the invoice instead' });
      if (outcome === 'paid') return reply.status(409).send({ error: 'Payments already taken cover this charge. An administrator must void a payment first.' });
      await recordAudit({
        entity: 'Invoice', recordId: id, clinicId: existing.clinicId, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { removed: item.kind, amount: item.amount },
      });
      return { success: true, invoice: present((await loadInvoice(id))!) };
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
    }
  });

  // Take a payment - all of the balance or part of it - and issue the
  // facility's next receipt number.
  fastify.post('/invoices/:id/payments', billing, async (request, reply) => {
    const { id } = request.params as any;
    const body = (request.body ?? {}) as any;
    const authUser = getAuthUser(request);
    if (!isPaymentMethod(body.method)) return reply.status(400).send({ error: 'Choose how the patient paid' });
    let amount: number;
    try {
      amount = parseAmount(body.amount);
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
    }
    return takePayment(request, reply, id, {
      amount, method: body.method, reference: cleanText(body.reference, 80), payerName: cleanText(body.payerName, 80), userId: authUser.userId,
    });
  });

  // Mark a bill paid: takes the whole balance as one payment (the older
  // one-button way; the method is recorded when given).
  fastify.patch('/invoices/:id/pay', billing, async (request, reply) => {
    const { id } = request.params as any;
    const body = (request.body ?? {}) as any;
    try {
      const existing = await prisma.invoice.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send({ error: 'Invoice not found' });
      if (!assertClinicMatch(request, reply, existing.clinicId)) return;
      return takePayment(request, reply, id, {
        amount: balanceOf(existing), method: isPaymentMethod(body.method) ? body.method : null,
        reference: cleanText(body.reference, 80), payerName: null, userId: getAuthUser(request).userId,
      });
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
    }
  });

  async function takePayment(
    request: FastifyRequest, reply: FastifyReply, id: string,
    input: { amount: number; method: keyof typeof PAYMENT_METHODS | null; reference: string | null; payerName: string | null; userId: string },
  ) {
    const authUser = getAuthUser(request);
    try {
      const existing = await prisma.invoice.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send({ error: 'Invoice not found' });
      if (!assertClinicMatch(request, reply, existing.clinicId)) return;

      const outcome = await prisma.$transaction(async (tx) => {
        await lockInvoice(tx, id);
        const fresh = await tx.invoice.findUniqueOrThrow({ where: { id } });
        if (fresh.status === 'CANCELLED') return { error: 'This invoice was cancelled', status: 409 };
        const balance = balanceOf(fresh);
        if (balance <= 0) return { error: 'This invoice is already paid', status: 409 };
        if (input.amount > balance) return { error: `That is more than the balance of ${ugx(balance)}`, status: 400 };
        const { lastReceiptNumber } = await tx.clinic.update({
          where: { id: fresh.clinicId }, data: { lastReceiptNumber: { increment: 1 } }, select: { lastReceiptNumber: true },
        });
        const payment = await tx.patientPayment.create({
          data: {
            clinicId: fresh.clinicId, invoiceId: id, receiptNumber: lastReceiptNumber, amount: input.amount, method: input.method,
            reference: input.reference, payerName: input.payerName, receivedByUserId: input.userId,
          },
        });
        await settleInvoice(tx, id);
        return { payment };
      });
      if (!('payment' in outcome) || !outcome.payment) return reply.status(outcome.status ?? 409).send({ error: outcome.error });

      await recordAudit({
        entity: 'PatientPayment', recordId: outcome.payment.id, clinicId: existing.clinicId, action: 'CREATE',
        actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { amount: input.amount, method: input.method, receipt: outcome.payment.receiptNumber },
      });
      const invoice = present((await loadInvoice(id))!);
      return {
        success: true,
        payment: { ...outcome.payment, receiptNumber: formatReceiptNumber(outcome.payment.receiptNumber) },
        invoice,
      };
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
    }
  }

  // Cancel a bill charged by mistake or waived. Kept, marked cancelled - and
  // only while no payment stands against it.
  fastify.patch('/invoices/:id/cancel', adminOnly, async (request, reply) => {
    const { id } = request.params as any;

    try {
      const existing = await prisma.invoice.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send({ error: 'Invoice not found' });
      if (!assertClinicMatch(request, reply, existing.clinicId)) return;
      if (existing.status === 'CANCELLED') return reply.status(409).send({ error: 'This invoice is already cancelled' });
      if (existing.status === 'PAID') return reply.status(409).send({ error: "A paid invoice can't be cancelled" });
      if (existing.amountPaid > 0) return reply.status(409).send({ error: 'Payments have been taken on this invoice - void them first' });

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

  // Void a payment taken by mistake (wrong amount, wrong patient). It stays on
  // record, marked VOID with the reason, and stops counting towards the bill
  // and the day's takings.
  fastify.post('/payments/:id/void', adminOnly, async (request, reply) => {
    const { id } = request.params as any;
    const reason = cleanText((request.body as any)?.reason, 200);
    if (!reason || reason.length < 3) return reply.status(400).send({ error: 'Say why the payment is being voided' });
    const authUser = getAuthUser(request);
    try {
      const payment = await prisma.patientPayment.findUnique({ where: { id } });
      if (!payment) return reply.status(404).send({ error: 'Payment not found' });
      if (!assertClinicMatch(request, reply, payment.clinicId)) return;
      if (payment.voidedAt) return reply.status(409).send({ error: 'This payment is already void' });

      await prisma.$transaction(async (tx) => {
        await lockInvoice(tx, payment.invoiceId);
        await tx.patientPayment.update({ where: { id }, data: { voidedAt: new Date(), voidedByUserId: authUser.userId, voidReason: reason } });
        await settleInvoice(tx, payment.invoiceId);
      });
      await recordAudit({
        entity: 'PatientPayment', recordId: id, clinicId: payment.clinicId, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { voided: true, amount: payment.amount, receipt: payment.receiptNumber },
      });
      return { success: true, invoice: present((await loadInvoice(payment.invoiceId))!) };
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
    }
  });

  /** A payment with everything its receipt needs. */
  async function receiptFor(request: FastifyRequest, reply: FastifyReply, id: string) {
    const clinicId = (await prisma.patientPayment.findUnique({ where: { id }, select: { clinicId: true } }))?.clinicId;
    if (!clinicId) {
      reply.status(404).send({ error: 'Payment not found' });
      return null;
    }
    if (!assertClinicMatch(request, reply, clinicId)) return null;
    return buildReceipt(id, await documentProducer(getAuthUser(request).userId));
  }

  // The printable receipt for a payment.
  fastify.get('/payments/:id/receipt/pdf', billing, async (request, reply) => {
    const { id } = request.params as any;
    try {
      const receipt = await receiptFor(request, reply, id);
      if (!receipt) return;
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="receipt-${formatReceiptNumber(receipt.payment.receiptNumber)}.pdf"`);
      return reply.send(receipt.pdf);
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // Email a receipt (PDF attached) to the patient's address, or another given.
  fastify.post('/payments/:id/receipt/email', billing, async (request, reply) => {
    const { id } = request.params as any;
    const given = typeof (request.body as any)?.email === 'string' ? (request.body as any).email.trim() : '';
    try {
      const receipt = await receiptFor(request, reply, id);
      if (!receipt) return;
      const to = given || receipt.invoice.patient.email || '';
      if (!EMAIL_PATTERN.test(to)) return reply.status(400).send({ error: 'Enter the email address to send the receipt to' });
      if (receipt.payment.voidedAt) return reply.status(409).send({ error: 'This payment was voided - its receipt is not sent' });
      const number = formatReceiptNumber(receipt.payment.receiptNumber);
      const balance = balanceOf(receipt.invoice);
      const result = await sendMail({
        to,
        subject: `Your receipt ${number} from ${receipt.payment.clinic.name}`,
        html: patientReceiptEmail({
          clinicName: receipt.payment.clinic.name,
          patientName: receipt.invoice.patient.name,
          receiptNumber: number,
          amount: ugx(receipt.payment.amount),
          method: receipt.payment.method ? PAYMENT_METHODS[receipt.payment.method] : 'Not recorded',
          receivedAt: receipt.payment.receivedAt,
          balance: balance > 0 ? ugx(balance) : null,
        }),
        attachments: [{ filename: `receipt-${number}.pdf`, content: receipt.pdf, contentType: 'application/pdf' }],
      });
      if (!result.sent) return reply.status(502).send({ error: "The receipt couldn't be emailed just now - download it and share it instead" });
      return { success: true, to };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // Download a branded PDF of an invoice: its lines, payments and balance.
  fastify.get('/invoices/:id/pdf', billing, async (request, reply) => {
    const { id } = request.params as any;

    try {
      const invoice = await loadInvoice(id);
      if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
      if (!assertClinicMatch(request, reply, invoice.clinicId)) return;

      const clinic = await prisma.clinic.findUniqueOrThrow({ where: { id: invoice.clinicId }, select: { id: true, name: true, facilityCode: true, phone: true } });
      const pdf = await generateInvoicePdf({
        invoiceId: invoice.id,
        clinicName: clinic.name,
        facilityCode: clinic.facilityCode,
        clinicPhone: clinic.phone,
        clinicLogo: await facilityLogo(clinic.id),
        patientName: invoice.patient.name,
        patientPhone: invoice.patient.phone,
        diagnosis: invoice.consultation?.diagnosis ?? null,
        doctorName: invoice.consultation?.appointment.doctor?.name,
        amount: invoice.amount,
        amountPaid: invoice.amountPaid,
        status: invoice.status,
        createdAt: invoice.createdAt,
        paidAt: invoice.paidAt,
        items: billLines(invoice),
        payments: invoice.payments.map((p) => ({
          receiptNumber: formatReceiptNumber(p.receiptNumber), receivedAt: p.receivedAt,
          method: p.method ? PAYMENT_METHODS[p.method] : 'Not recorded', amount: p.amount, voided: !!p.voidedAt,
        })),
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
