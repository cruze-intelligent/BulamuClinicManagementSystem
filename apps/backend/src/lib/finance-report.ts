import type { ChargeKind, ExpenseCategory, PaymentMethod } from '@prisma/client';
import { prisma } from './prisma';
import { CHARGE_KINDS, EXPENSE_CATEGORIES, PAYMENT_METHODS, eatDateKey, eatDayRange, formatReceiptNumber } from './invoices';
import { buildCsv } from './csv';

/**
 * A facility's financial report, for its books or its accountant: everything,
 * or one section (money received, billed to patients, money paid out, still
 * owed), optionally narrowed to one category of that section - a payment
 * method, a kind of charge or a kind of spending - over any period of up to a
 * year. The same report comes as a spreadsheet (CSV) or a PDF.
 *
 * Voided receipts and expenses are listed, marked void, and never counted in
 * any total. What is still owed is as of today, whatever the period.
 */

export const REPORT_SECTIONS = {
  income: 'Money received',
  billed: 'Billed to patients',
  expenses: 'Money paid out',
  outstanding: 'Still owed by patients',
} as const;
export type ReportSection = keyof typeof REPORT_SECTIONS;
const SECTION_ORDER = Object.keys(REPORT_SECTIONS) as ReportSection[];

/** What each section can be narrowed to. */
export const REPORT_CATEGORIES: Partial<Record<ReportSection, Record<string, string>>> = {
  income: PAYMENT_METHODS,
  billed: CHARGE_KINDS,
  expenses: EXPENSE_CATEGORIES,
};

export const MAX_REPORT_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ReportRequest = {
  from: string;
  to: string;
  start: Date;
  end: Date;
  /** 'all', or the one section asked for. */
  section: ReportSection | 'all';
  category: string | null;
};

const isDay = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/**
 * Reads ?from=&to= (EAT days, both included; this month so far when left out),
 * ?section= (all by default) and ?category= (only with one section that has
 * categories). Says plainly what is wrong rather than guessing.
 */
export function parseReportRequest(query: Record<string, unknown>): { request: ReportRequest } | { error: string } {
  const today = eatDateKey(new Date());
  const from = query.from === undefined || query.from === '' ? `${today.slice(0, 8)}01` : query.from;
  const to = query.to === undefined || query.to === '' ? today : query.to;
  if (!isDay(from) || !isDay(to)) return { error: 'Choose the dates as YYYY-MM-DD.' };
  if (to < from) return { error: 'The end date is before the start date.' };
  const start = eatDayRange(from).start;
  const end = eatDayRange(to).end;
  if (end.getTime() - start.getTime() > MAX_REPORT_DAYS * DAY_MS) return { error: 'A report covers at most one year - choose a shorter period.' };

  const sectionRaw = query.section === undefined || query.section === '' ? 'all' : query.section;
  if (sectionRaw !== 'all' && !(typeof sectionRaw === 'string' && sectionRaw in REPORT_SECTIONS)) {
    return { error: 'Choose what to include: everything, money received, billed, money paid out or still owed.' };
  }
  const section = sectionRaw as ReportSection | 'all';

  let category: string | null = null;
  if (query.category !== undefined && query.category !== '' && query.category !== 'all') {
    const options = section === 'all' ? undefined : REPORT_CATEGORIES[section];
    if (!options) return { error: 'A category can only be chosen together with money received, billed or money paid out.' };
    if (typeof query.category !== 'string' || !(query.category in options)) return { error: 'That category does not exist for this section.' };
    category = query.category;
  }
  return { request: { from, to, start, end, section, category } };
}

/** One line of the report, the same shape in every section. */
export type ReportLine = {
  date: string;
  reference: string;
  /** Who paid, who was paid, or the patient billed. */
  name: string;
  category: string;
  details: string;
  method: string;
  amount: number;
  by: string;
  /** Why it was voided; null for a line that counts. */
  voided: string | null;
};

export type ReportSectionResult = {
  key: ReportSection;
  title: string;
  total: number;
  count: number;
  byCategory: Array<{ label: string; total: number; count: number }>;
  lines: ReportLine[];
};

export type FinanceReport = {
  facility: { id: string; name: string; facilityCode: string; phone: string | null };
  from: string;
  to: string;
  asOf: string;
  section: ReportSection | 'all';
  sectionLabel: string;
  category: string | null;
  categoryLabel: string | null;
  sections: ReportSectionResult[];
  /** Received less paid out, when both are in the report. */
  net: number | null;
};

const billNo = (invoiceId: string) => `Bill #${invoiceId.slice(0, 8)}`;
const methodLabel = (method: PaymentMethod | null) => (method ? PAYMENT_METHODS[method] : 'Not recorded');

function summarise(key: ReportSection, lines: ReportLine[]): ReportSectionResult {
  const counted = lines.filter((l) => !l.voided);
  const groups = new Map<string, { label: string; total: number; count: number }>();
  for (const line of counted) {
    const group = groups.get(line.category) ?? { label: line.category, total: 0, count: 0 };
    group.total += line.amount;
    group.count += 1;
    groups.set(line.category, group);
  }
  return {
    key,
    title: REPORT_SECTIONS[key],
    total: counted.reduce((sum, l) => sum + l.amount, 0),
    count: counted.length,
    byCategory: [...groups.values()].sort((a, b) => b.total - a.total),
    lines,
  };
}

export async function buildFinanceReport(clinicId: string, request: ReportRequest): Promise<FinanceReport> {
  const { start, end, section, category } = request;
  const wanted = section === 'all' ? SECTION_ORDER : [section];
  const has = (key: ReportSection) => wanted.includes(key);

  const [facility, payments, items, expenses, owing] = await Promise.all([
    prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { id: true, name: true, facilityCode: true, phone: true } }),
    has('income')
      ? prisma.patientPayment.findMany({
          where: { clinicId, receivedAt: { gte: start, lt: end }, ...(category ? { method: category as PaymentMethod } : {}) },
          include: { receivedBy: { select: { name: true } }, invoice: { select: { id: true, patient: { select: { name: true } } } } },
          orderBy: [{ receivedAt: 'asc' }, { receiptNumber: 'asc' }],
        })
      : [],
    has('billed')
      ? prisma.invoiceItem.findMany({
          where: { createdAt: { gte: start, lt: end }, invoice: { clinicId, status: { not: 'CANCELLED' } }, ...(category ? { kind: category as ChargeKind } : {}) },
          include: { invoice: { select: { id: true, patient: { select: { name: true } } } } },
          orderBy: { createdAt: 'asc' },
        })
      : [],
    has('expenses')
      ? prisma.expense.findMany({
          where: { clinicId, spentOn: { gte: start, lt: end }, ...(category ? { category: category as ExpenseCategory } : {}) },
          include: { recordedBy: { select: { name: true } } },
          orderBy: [{ spentOn: 'asc' }, { createdAt: 'asc' }],
        })
      : [],
    has('outstanding')
      ? prisma.invoice.findMany({
          where: { clinicId, status: 'PENDING' },
          include: { patient: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        })
      : [],
  ]);

  const sections: ReportSectionResult[] = [];
  if (has('income')) {
    sections.push(summarise('income', payments.map((p) => ({
      date: eatDateKey(p.receivedAt),
      reference: `Receipt ${formatReceiptNumber(p.receiptNumber)}`,
      name: p.payerName || p.invoice.patient.name,
      category: methodLabel(p.method),
      details: [`For ${billNo(p.invoice.id).toLowerCase()}`, p.provider, p.reference ? `ref ${p.reference}` : null].filter(Boolean).join(', '),
      method: methodLabel(p.method),
      amount: p.amount,
      by: p.receivedBy?.name ?? '',
      voided: p.voidedAt ? p.voidReason || 'no reason given' : null,
    }))));
  }
  if (has('billed')) {
    sections.push(summarise('billed', items.map((i) => ({
      date: eatDateKey(i.createdAt),
      reference: billNo(i.invoice.id),
      name: i.invoice.patient.name,
      category: CHARGE_KINDS[i.kind],
      details: i.quantity > 1 ? `${i.description} (${i.quantity} x ${i.unitPrice.toLocaleString('en-US')})` : i.description,
      method: '',
      amount: i.amount,
      by: '',
      voided: null,
    }))));
  }
  if (has('expenses')) {
    sections.push(summarise('expenses', expenses.map((e) => ({
      date: eatDateKey(e.spentOn),
      reference: e.reference ?? '',
      name: e.paidTo ?? '',
      category: EXPENSE_CATEGORIES[e.category],
      details: e.description,
      method: methodLabel(e.method),
      amount: e.amount,
      by: e.recordedBy?.name ?? '',
      voided: e.voidedAt ? e.voidReason || 'no reason given' : null,
    }))));
  }
  if (has('outstanding')) {
    const lines = owing
      .map((inv) => ({ inv, balance: Math.max(0, Math.round(inv.amount - inv.amountPaid)) }))
      .filter((o) => o.balance > 0)
      .map(({ inv, balance }) => ({
        date: eatDateKey(inv.createdAt),
        reference: billNo(inv.id),
        name: inv.patient.name,
        category: inv.amountPaid > 0 ? 'Part paid' : 'Unpaid',
        details: `Billed ${Math.round(inv.amount).toLocaleString('en-US')}, paid ${Math.round(inv.amountPaid).toLocaleString('en-US')}`,
        method: '',
        amount: balance,
        by: '',
        voided: null,
      }));
    sections.push(summarise('outstanding', lines));
  }

  const income = sections.find((s) => s.key === 'income');
  const spent = sections.find((s) => s.key === 'expenses');
  return {
    facility,
    from: request.from,
    to: request.to,
    asOf: eatDateKey(new Date()),
    section,
    sectionLabel: section === 'all' ? 'Everything' : REPORT_SECTIONS[section],
    category,
    categoryLabel: category && section !== 'all' ? REPORT_CATEGORIES[section]?.[category] ?? null : null,
    sections,
    net: income && spent && !category ? income.total - spent.total : null,
  };
}

export function reportFileName(report: FinanceReport, extension: 'csv' | 'pdf'): string {
  const what = report.section === 'all' ? 'all' : report.section;
  const narrowed = report.category ? `-${report.category.toLowerCase().replace(/_/g, '-')}` : '';
  return `financial-report-${what}${narrowed}-${report.from}-to-${report.to}.${extension}`;
}

/** One table for every section: a Section column tells the lines apart. */
export function financeReportCsv(report: FinanceReport): string {
  type Row = ReportLine & { section: string };
  const rows: Row[] = report.sections.flatMap((s) => s.lines.map((line) => ({ ...line, section: s.title })));
  return buildCsv<Row>(
    [
      ['Section', (r) => r.section],
      ['Date', (r) => r.date],
      ['Receipt / bill / reference', (r) => r.reference],
      ['Received from / paid to / patient', (r) => r.name],
      ['Category', (r) => r.category],
      ['Details', (r) => r.details],
      ['Method', (r) => r.method],
      ['Amount (UGX)', (r) => r.amount],
      ['Recorded by', (r) => r.by],
      ['Status', (r) => (r.voided ? `Void (not counted): ${r.voided}` : '')],
    ],
    rows
  );
}
