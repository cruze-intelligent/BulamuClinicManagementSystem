import path from 'path';
import fs from 'fs';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { formatPrescriptionLine } from './clinical';
import { documentTitle } from './document-name';
import { pesapalMerchantName } from '../services/pesapal.service';

const BRAND_TEAL = '#0f766e';
const BRAND_TEAL_DARK = '#0c5f58';
const INK = '#1e293b';
const MUTED = '#64748b';
const SITE_URL = 'https://bulamu.site';
/** Bulamu's tagline is set in Playfair Display (SIL Open Font License), with a built-in italic if the file is missing. */
const TAGLINE_FONT_FILE = path.join(__dirname, '..', '..', 'assets', 'fonts', 'PlayfairDisplay-SemiBoldItalic.woff');
const hasTaglineFont = fs.existsSync(TAGLINE_FONT_FILE);
function taglineFont(doc: PDFKit.PDFDocument): string {
  if (!hasTaglineFont) return 'Times-BoldItalic';
  doc.registerFont('BulamuTagline', TAGLINE_FONT_FILE);
  return 'BulamuTagline';
}
export const COMPANY_NAME = 'Cruze Intelligent Systems (U) Ltd';

// Every date on a document is East Africa Time, day-month-year - the server
// runs in UTC with US defaults, which printed 10/13/2026 and the wrong hour.
const TIME_ZONE = 'Africa/Kampala';

export function documentDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TIME_ZONE });
}

function documentDateTime(date: Date): string {
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE });
  return `${documentDate(date)}, ${time} EAT`;
}

/** Who heads a document: the facility for its own documents, Bulamu for its subscription receipts. */
export type Letterhead = {
  name: string;
  motto?: string | null;
  /** Under the name, once: the Facility ID and the phone number. */
  lines?: Array<string | null | undefined>;
  logo?: Buffer | null;
};

/** The heading a facility's own documents carry: its logo, name, motto, Facility ID and phone. */
export function facilityLetterhead(input: { name: string; facilityCode?: string | null; phone?: string | null; motto?: string | null; logo?: Buffer | null }): Letterhead {
  return {
    name: input.name,
    motto: input.motto,
    lines: [input.facilityCode ? `Facility ID ${input.facilityCode}` : null, input.phone],
    logo: input.logo,
  };
}

/**
 * The letterhead on the first page, as a facility's own stationery would be:
 * its logo on a white panel at the left, then its name, its motto beneath, and
 * its Facility ID and phone once, under the name. Bulamu, which makes the
 * document, is named in the footer of every page instead (see finishDocument).
 */
function drawLetterhead(doc: PDFKit.PDFDocument, head: Letterhead) {
  const height = 86;
  doc.rect(0, 0, doc.page.width, height).fill(BRAND_TEAL);

  let textX = 50;
  if (head.logo) {
    const box = { w: 88, h: 66 };
    try {
      doc.roundedRect(50, 10, box.w, box.h, 6).fill('#ffffff');
      doc.image(head.logo, 50 + 6, 10 + 5, { fit: [box.w - 12, box.h - 10], align: 'center', valign: 'center' });
      textX = 50 + box.w + 14;
    } catch {
      // An unreadable image never stops the document - it goes out without it.
    }
  }
  const width = doc.page.width - 50 - textX;

  // A long name steps down a size rather than running into the motto.
  doc.font('Helvetica-Bold');
  let size = 18;
  while (size > 12 && doc.fontSize(size).widthOfString(head.name) > width) size -= 1;
  doc.fillColor('#ffffff').fontSize(size).text(head.name, textX, 16, { width, height: size * 2.4, ellipsis: true });

  let y = Math.max(doc.y + 2, 38);
  if (head.motto?.trim()) {
    doc.fillColor('#d1fae5').font('Helvetica-Oblique').fontSize(9.5).text(head.motto.trim(), textX, y, { width, lineBreak: false, ellipsis: true });
    y += 14;
  }
  const lines = (head.lines ?? []).filter(Boolean).join('   |   ');
  if (lines) doc.fillColor('#d1fae5').font('Helvetica').fontSize(9).text(lines, textX, y, { width, lineBreak: false, ellipsis: true });

  doc.fillColor(INK).font('Helvetica').fontSize(10);
  doc.x = 50;
  doc.y = height + 22;
}

/**
 * Ends a document with the shared footer on every page: a QR code to the site,
 * who makes Bulamu, when it was produced, and "Page n of m" - so a single page
 * that comes loose still says where it came from. QR generation failing never
 * blocks the document itself. A sample (for checking how documents look) is
 * stamped as such on every page, so it can never pass for a real one.
 */
async function finishDocument(doc: PDFKit.PDFDocument, options: SampleOption = {}): Promise<void> {
  const { sample = false, producedBy } = options;
  const qrSize = 42;
  let qr: Buffer | null = null;
  try {
    qr = await QRCode.toBuffer(SITE_URL, { margin: 0, width: qrSize, color: { dark: BRAND_TEAL, light: '#ffffff' } });
  } catch {
    // The footer text still renders without the QR code.
  }
  const by = !producedBy ? '' : typeof producedBy === 'string' ? ` - ${producedBy}` : ` by ${producedBy.name}, ${producedBy.role}`;
  const generated = `${documentDateTime(new Date())}${by}`;
  const { start, count } = doc.bufferedPageRange();

  for (let i = start; i < start + count; i++) {
    doc.switchToPage(i);
    if (sample) {
      const centreY = doc.page.height / 2;
      doc.save();
      doc.rotate(-35, { origin: [doc.page.width / 2, centreY] });
      doc.font('Helvetica-Bold').fontSize(46).fillColor('#dc2626').fillOpacity(0.14)
        .text('SAMPLE - NOT A REAL DOCUMENT', 0, centreY - 23, { width: doc.page.width, align: 'center', lineBreak: false });
      doc.restore();
      doc.fillOpacity(1);
    }
    // PDFKit starts a new page for any text that would end past maxY(), even
    // with an explicit position - keep the whole block comfortably above it.
    const topY = doc.page.maxY() - 47;
    const textX = 50 + qrSize + 12;
    const textWidth = doc.page.width - 50 - textX;
    if (qr) doc.image(qr, 50, topY, { width: qrSize, height: qrSize });
    // Bulamu, and its tagline in a serif italic; then where it comes from, who produced this copy, and the page.
    // Both on one baseline: drawn from the top of the line, the serif sat lower than the name.
    const baseline = topY + 8;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND_TEAL);
    const nameWidth = doc.widthOfString('Bulamu');
    doc.text('Bulamu', textX, baseline, { lineBreak: false, baseline: 'alphabetic' });
    doc.font(taglineFont(doc)).fontSize(11).fillColor(BRAND_TEAL_DARK)
      .text('Transforming patient care.', textX + nameWidth + 7, baseline, { lineBreak: false, baseline: 'alphabetic' });
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(`bulamu.site - a product of ${COMPANY_NAME}`, textX, topY + 15, { width: textWidth, lineBreak: false })
      .text(`Produced ${generated}   |   Page ${i - start + 1} of ${count}`, textX, topY + 25, { width: textWidth, lineBreak: false });
  }
  doc.end();
}

/** A label/value table, as used at the top of every document. */
function drawRows(doc: PDFKit.PDFDocument, rows: Array<[string, string | null | undefined]>, valueX: number, gap = 0.6) {
  doc.fontSize(10);
  for (const [label, value] of rows) {
    if (!value) continue;
    const y = doc.y;
    doc.fillColor(MUTED).font('Helvetica').text(label, 50, y, { width: valueX - 60 });
    doc.fillColor(INK).font('Helvetica-Bold').text(value, valueX, y, { width: doc.page.width - 50 - valueX });
    doc.moveDown(gap);
  }
}

/**
 * Signature lines. Under each: the printed name and role of the person who
 * signs (when known), then what the line is for - so a signature can always
 * be matched to a named, accountable member of staff.
 */
function drawSignatures(doc: PDFKit.PDFDocument, lines: Array<{ label: string; signer?: Signer | null }>) {
  const sigY = doc.y;
  const columns = [{ x: 50, width: 200 }, { x: 310, width: 235 }];
  doc.strokeColor(MUTED).lineWidth(0.5);
  lines.forEach((line, i) => {
    const { x, width } = columns[i];
    doc.moveTo(x, sigY + 20).lineTo(x + width, sigY + 20).stroke();
    let y = sigY + 24;
    if (line.signer) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(line.signer.name, x, y, { width, lineBreak: false });
      doc.font('Helvetica').fontSize(8).fillColor(INK).text(line.signer.role, x, y + 11, { width, lineBreak: false });
      y += 23;
    }
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(line.label, x, y, { width, lineBreak: false });
  });
}

const money = (currency: string, amount: number) => `${currency} ${amount.toLocaleString('en-US')}`;

/**
 * Shared by every document. `producedBy` is whoever generated this copy - a
 * staff member, or for a patient's own download a plain description - and is
 * printed in the footer of every page. `sample` is set only for the sample
 * documents the platform administrator can request.
 */
type SampleOption = { sample?: boolean; producedBy?: Signer | string | null };

export type Signer = { name: string; role: string };

/** One line of a bill, as printed. */
export type BillLine = { description: string; kind?: string; quantity: number; unitPrice: number; amount: number };
/** A payment against a bill, as printed. */
export type BillPayment = { receiptNumber: string; receivedAt: Date; method: string; amount: number; voided?: boolean };

export type InvoicePdfInput = SampleOption & {
  invoiceId: string;
  clinicName: string;
  facilityCode: string;
  clinicPhone?: string | null;
  clinicLogo?: Buffer | null;
  /** The facility's motto, under its name in the letterhead. */
  clinicMotto?: string | null;
  patientName: string;
  /** The facility's Patient ID, as printed (00042). */
  patientNumber?: string | null;
  patientPhone: string;
  /** The visit's diagnosis, for a bill that belongs to a visit. */
  diagnosis?: string | null;
  doctorName?: string;
  amount: number;
  /** What has been paid so far (when left out, a paid bill counts as paid in full). */
  amountPaid?: number;
  currency?: string;
  status: string;
  createdAt: Date;
  paidAt?: Date | null;
  /** The lines of the bill; without them it prints as one consultation line. */
  items?: BillLine[];
  payments?: BillPayment[];
};

/**
 * A table of bill lines - item, quantity, unit price and amount - with the
 * total beneath. Starts a new page (with a "continued" line) rather than
 * running into the footer.
 */
function drawBillLines(doc: PDFKit.PDFDocument, lines: BillLine[], currency: string, continued: string) {
  const cols = { item: 50, qty: 330, unit: 375, amount: 460 };
  const right = doc.page.width - 50;
  const header = () => {
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED);
    doc.text('Item', cols.item, y, { width: 270 });
    doc.text('Qty', cols.qty, y, { width: 40, align: 'right' });
    doc.text('Unit price', cols.unit, y, { width: 80, align: 'right' });
    doc.text('Amount', cols.amount, y, { width: right - cols.amount, align: 'right' });
    doc.moveDown(0.4);
    doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, doc.y).lineTo(right, doc.y).stroke();
    doc.moveDown(0.4);
  };
  header();
  for (const line of lines) {
    if (doc.y > doc.page.maxY() - 110) {
      doc.addPage();
      doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text(continued, 50, 50, { width: 495 });
      doc.y = 80;
      header();
    }
    const y = doc.y;
    doc.font('Helvetica').fontSize(10).fillColor(INK).text(line.description, cols.item, y, { width: 270 });
    if (line.kind && line.kind.toLowerCase() !== line.description.toLowerCase()) doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(line.kind, cols.item, doc.y, { width: 270 });
    const bottom = doc.y;
    doc.font('Helvetica').fontSize(10).fillColor(INK);
    doc.text(String(line.quantity), cols.qty, y, { width: 40, align: 'right' });
    doc.text(line.unitPrice.toLocaleString('en-US'), cols.unit, y, { width: 80, align: 'right' });
    doc.text(line.amount.toLocaleString('en-US'), cols.amount, y, { width: right - cols.amount, align: 'right' });
    doc.y = Math.max(bottom, doc.y);
    doc.moveDown(0.35);
  }
  doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, doc.y).lineTo(right, doc.y).stroke();
  doc.moveDown(0.4);
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  const y = doc.y;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('Total', cols.unit - 60, y, { width: 140, align: 'right' });
  doc.text(money(currency, total), cols.amount - 20, y, { width: right - cols.amount + 20, align: 'right' });
  doc.x = 50;
}

/** Unpaid, Part paid, Paid or Cancelled - in the words printed on bills. */
export function billState(input: { amount: number; amountPaid: number; status: string }): string {
  if (input.status === 'CANCELLED') return 'Cancelled';
  if (input.amount > 0 && input.amountPaid >= input.amount) return 'Paid';
  return input.amountPaid > 0 ? 'Part paid' : 'Unpaid';
}

/**
 * A facility's bill to its patient: each item charged, the payments made and
 * the balance. Bulamu only keeps the record: the facility issues it and
 * collects the money, and the invoice says so.
 */
export async function generateInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  const { doc, done } = newDocument(documentTitle('Invoice', input.patientName, input.createdAt));
  const currency = input.currency ?? 'UGX';
  drawLetterhead(doc, facilityLetterhead({ name: input.clinicName, facilityCode: input.facilityCode, phone: input.clinicPhone, motto: input.clinicMotto, logo: input.clinicLogo }));

  const cancelled = input.status === 'CANCELLED';
  const paidSoFar = input.amountPaid ?? (input.status === 'PAID' ? input.amount : 0);
  const balance = cancelled ? 0 : Math.max(0, input.amount - paidSoFar);
  const state = billState({ amount: input.amount, amountPaid: paidSoFar, status: input.status });

  doc.moveDown(2);
  doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text('INVOICE', 50);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`#${input.invoiceId}`);
  doc.moveDown(1.5);

  drawRows(doc, [
    ['Patient', input.patientName],
    ['Patient ID', input.patientNumber || null],
    ['Phone', input.patientPhone || '-'],
    ['Visit', input.diagnosis ? `Consultation - ${input.diagnosis}` : null],
    ['Attending clinician', input.doctorName || null],
    ['Invoice date', documentDate(input.createdAt)],
    ['Status', state],
    ['Paid in full on', input.paidAt && state === 'Paid' ? documentDate(input.paidAt) : null],
  ], 170);

  doc.moveDown(1);
  const lines = input.items?.length
    ? input.items
    : [{ description: input.diagnosis ? `Consultation - ${input.diagnosis}` : 'Consultation', quantity: 1, unitPrice: input.amount, amount: input.amount }];
  drawBillLines(doc, lines, currency, `Invoice for ${input.patientName} (continued) - #${input.invoiceId.slice(0, 8)}`);

  const payments = input.payments ?? [];
  if (payments.length) {
    if (doc.y > doc.page.maxY() - 140) doc.addPage();
    doc.moveDown(1.2);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND_TEAL_DARK).text('Payments', 50, doc.y);
    doc.moveDown(0.3);
    for (const p of payments) {
      const y = doc.y;
      doc.font('Helvetica').fontSize(9).fillColor(p.voided ? MUTED : INK)
        .text(`Receipt ${p.receiptNumber} - ${documentDate(p.receivedAt)} - ${p.method}${p.voided ? ' - VOID, not counted' : ''}`, 50, y, { width: 330 });
      doc.text(money(currency, p.amount), 380, y, { width: doc.page.width - 430, align: 'right' });
      doc.moveDown(0.2);
    }
  }

  if (doc.y > doc.page.maxY() - 120) doc.addPage();
  doc.moveDown(1.2);
  doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
  doc.moveDown(1);

  const amountY = doc.y;
  const headline = cancelled ? 'Amount (cancelled)' : state === 'Paid' ? 'Amount paid' : 'Balance due';
  doc.font('Helvetica').fontSize(11).fillColor(MUTED).text(headline, 50, amountY);
  doc.font('Helvetica-Bold').fontSize(22).fillColor(BRAND_TEAL_DARK).text(money(currency, cancelled || state === 'Paid' ? input.amount : balance), 50, amountY + 16);
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(state === 'Paid' ? '#15803d' : cancelled ? MUTED : '#b45309')
    .text(state.toUpperCase(), 0, amountY + 16, { align: 'right', width: doc.page.width - 50 });
  if (state === 'Part paid') {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      .text(`${money(currency, paidSoFar)} paid of ${money(currency, input.amount)}`, 0, amountY + 32, { align: 'right', width: doc.page.width - 50 });
  }

  doc.y = amountY + 56;
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(MUTED)
    .text(
      `This invoice is issued by ${input.clinicName}. Pay the facility directly - Bulamu keeps the facility's records but does not collect or hold patient payments.`,
      50, doc.y, { width: doc.page.width - 100 }
    );

  await finishDocument(doc, input);
  return done;
}

export type PatientReceiptPdfInput = SampleOption & {
  receiptNumber: string;
  clinicName: string;
  facilityCode: string;
  clinicPhone?: string | null;
  clinicLogo?: Buffer | null;
  clinicMotto?: string | null;
  patientName: string;
  patientNumber?: string | null;
  patientPhone?: string | null;
  payerName?: string | null;
  amount: number;
  currency?: string;
  method: string;
  reference?: string | null;
  /** What the reference is - Transaction ID, Member or claim number... */
  referenceLabel?: string | null;
  receivedAt: Date;
  receivedBy?: Signer | null;
  /** The bill this pays towards. */
  invoiceId: string;
  billTotal: number;
  /** Everything paid on the bill that stands, this payment included. */
  paidToDate: number;
  items: BillLine[];
  voided?: { at: Date; reason: string | null } | null;
};

/**
 * The facility's receipt to its patient for money received: numbered, with
 * how it was paid, who took it, and what is still owed on the bill. A voided
 * payment's receipt says VOID across every page.
 */
export async function generatePatientReceiptPdf(input: PatientReceiptPdfInput): Promise<Buffer> {
  const { doc, done } = newDocument(documentTitle('Receipt', input.patientName, input.receivedAt));
  const currency = input.currency ?? 'UGX';
  drawLetterhead(doc, facilityLetterhead({ name: input.clinicName, facilityCode: input.facilityCode, phone: input.clinicPhone, motto: input.clinicMotto, logo: input.clinicLogo }));

  doc.moveDown(2);
  doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text('RECEIPT', 50);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND_TEAL_DARK).text(`No. ${input.receiptNumber}`);
  if (input.voided) {
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#b91c1c')
      .text(`VOID - cancelled on ${documentDate(input.voided.at)}${input.voided.reason ? `: ${input.voided.reason}` : ''}`, 50, doc.y, { width: 495 });
  }
  doc.moveDown(1.2);

  const balance = Math.max(0, input.billTotal - input.paidToDate);
  drawRows(doc, [
    ['Received from', input.payerName ? `${input.payerName}, for ${input.patientName}` : input.patientName],
    ['Patient ID', input.patientNumber || null],
    ['Patient phone', input.patientPhone || null],
    ['Date', documentDateTime(input.receivedAt)],
    ['Paid by', input.method],
    [input.referenceLabel || 'Reference', input.reference || null],
    ['Received by', input.receivedBy ? `${input.receivedBy.name}, ${input.receivedBy.role}` : null],
    ['For invoice', `#${input.invoiceId.slice(0, 8)}`],
  ], 190);

  doc.moveDown(1);
  doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
  doc.moveDown(1);
  const amountY = doc.y;
  const right = doc.page.width - 50;
  doc.font('Helvetica').fontSize(11).fillColor(MUTED).text('Amount received', 50, amountY);
  doc.font('Helvetica-Bold').fontSize(24).fillColor(input.voided ? MUTED : BRAND_TEAL_DARK).text(money(currency, input.amount), 50, amountY + 16);
  doc.font('Helvetica').fontSize(10).fillColor(MUTED);
  doc.text(`Invoice total ${money(currency, input.billTotal)}`, 0, amountY + 4, { align: 'right', width: right });
  doc.text(`Paid to date ${money(currency, input.paidToDate)}`, 0, amountY + 19, { align: 'right', width: right });
  doc.font('Helvetica-Bold').fontSize(10).fillColor(balance === 0 ? '#15803d' : '#b45309')
    .text(balance === 0 ? 'PAID IN FULL' : `Balance ${money(currency, balance)}`, 0, amountY + 34, { align: 'right', width: right });

  doc.y = amountY + 64;
  doc.x = 50;
  if (input.items.length) {
    doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND_TEAL_DARK).text('What the invoice covers', 50, doc.y);
    doc.moveDown(0.4);
    drawBillLines(doc, input.items, currency, `Receipt ${input.receiptNumber} (continued)`);
  }

  if (doc.y > doc.page.maxY() - 140) doc.addPage();
  doc.moveDown(2);
  drawSignatures(doc, [{ label: 'Received by - signature and stamp', signer: input.receivedBy ?? null }]);
  doc.y += 60;
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(
    `Thank you. Keep this receipt as proof of payment to ${input.clinicName}. Bulamu keeps the facility's records but does not collect or hold patient payments.`,
    50, doc.y, { width: doc.page.width - 100 }
  );

  if (input.voided) {
    const { start, count } = doc.bufferedPageRange();
    for (let i = start; i < start + count; i++) {
      doc.switchToPage(i);
      const centreY = doc.page.height / 2;
      doc.save();
      doc.rotate(-35, { origin: [doc.page.width / 2, centreY] });
      doc.font('Helvetica-Bold').fontSize(90).fillColor('#b91c1c').fillOpacity(0.12)
        .text('VOID', 0, centreY - 45, { width: doc.page.width, align: 'center', lineBreak: false });
      doc.restore();
      doc.fillOpacity(1);
    }
  }

  await finishDocument(doc, input);
  return done;
}

export type PrescriptionPdfInput = SampleOption & {
  consultationId: string;
  clinicName: string;
  facilityCode: string;
  clinicPhone?: string | null;
  clinicLogo?: Buffer | null;
  clinicMotto?: string | null;
  patientName: string;
  patientNumber?: string | null;
  patientPhone: string;
  patientSex?: string | null;
  patientAge?: string;
  prescriberName?: string;
  /** The prescriber's role, as written on the document (e.g. "Doctor / Clinical Officer"). */
  prescriberRole?: string;
  date: Date;
  /** Why the patient came, printed above the diagnosis. */
  presentingComplaint?: string | null;
  diagnoses: Array<{ icd10Code: string | null; description: string; type: string; certainty: string; notes: string | null }>;
  prescriptions: Array<{
    medication: string; strength: string | null; form: string | null; dosage: string; route: string | null;
    frequency: string; duration: string; quantity: number | null; instructions: string | null;
  }>;
  /** Procedures in the treatment plan (incision and drainage, ear syringing...). */
  procedures?: Array<{ name: string; notes: string | null }>;
};

/**
 * The visit's medical form: who it is for (with age and sex - doses depend on
 * them), the presenting complaint and diagnosis, then the treatment plan - each
 * prescription item with the drug on one line and its directions in plain words
 * beneath, as a pharmacist expects to read it, and any procedures - and
 * signature lines for the prescriber and the dispenser.
 */
export async function generatePrescriptionPdf(input: PrescriptionPdfInput): Promise<Buffer> {
  const { doc, done } = newDocument(documentTitle('Medical form', input.patientName, input.date));

  drawLetterhead(doc, facilityLetterhead({ name: input.clinicName, facilityCode: input.facilityCode, phone: input.clinicPhone, motto: input.clinicMotto, logo: input.clinicLogo }));

  doc.moveDown(1.5);
  doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text('MEDICAL FORM');
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`#${input.consultationId}`);
  doc.moveDown(1);

  const labelX = 50;
  const valueX = 170;
  const sexAge = [input.patientSex ? input.patientSex.charAt(0) + input.patientSex.slice(1).toLowerCase() : '', input.patientAge].filter(Boolean).join(', ');
  const details: [string, string][] = [
    ['Patient', input.patientName],
    ...(input.patientNumber ? ([['Patient ID', input.patientNumber]] as [string, string][]) : []),
    ['Age / sex', sexAge || '-'],
    ['Phone', input.patientPhone || '-'],
    ['Date', documentDate(input.date)],
    ['Prescriber', input.prescriberName || '-'],
  ];
  doc.fontSize(10);
  for (const [label, value] of details) {
    const y = doc.y;
    doc.fillColor(MUTED).font('Helvetica').text(label, labelX, y, { width: 110 });
    doc.fillColor(INK).font('Helvetica-Bold').text(value, valueX, y, { width: 370 });
    doc.moveDown(0.5);
  }

  const rule = () => {
    doc.moveDown(0.6);
    doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
    doc.moveDown(0.8);
  };

  const complaint = input.presentingComplaint?.trim();
  if (complaint) {
    rule();
    doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND_TEAL_DARK).text('Presenting complaint', labelX, doc.y);
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(10).fillColor(INK).text(complaint, labelX, doc.y, { width: 495 });
  }

  rule();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND_TEAL_DARK).text('Diagnosis', labelX, doc.y);
  doc.moveDown(0.3);
  for (const d of input.diagnoses) {
    const code = d.icd10Code ? ` (${d.icd10Code})` : '';
    const status = d.certainty === 'PROVISIONAL' ? ' - provisional' : '';
    const role = d.type === 'PRIMARY' ? 'Primary: ' : 'Also: ';
    doc.font('Helvetica').fontSize(10).fillColor(INK).text(`${role}${d.description}${code}${status}`, labelX, doc.y, { width: 495 });
  }

  // A continuation page always says whose form it is - a loose page must
  // never be separable from its patient.
  const continuePage = () => {
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED)
      .text(`Medical form for ${input.patientName} (continued) - #${input.consultationId.slice(0, 8)}`, labelX, 50, { width: 495 });
    doc.y = 80;
  };

  if (input.prescriptions.length) {
    rule();
    doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND_TEAL_DARK).text('Rx', labelX, doc.y);
    doc.moveDown(0.4);
  }

  input.prescriptions.forEach((rx, index) => {
    const line = formatPrescriptionLine(rx);
    // Keep an item's lines together: start a new page rather than split one across pages.
    if (doc.y > doc.page.maxY() - 140) continuePage();
    // The line as prescribers write it - route, drug and dose, frequency, duration -
    // then what the dispenser needs: the form, how many to dispense, any instructions.
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(`${index + 1}.  ${line.order}`, labelX, doc.y, { width: 495 });
    const extras = [line.details, line.quantity, line.instructions].filter(Boolean).join('   |   ');
    if (extras) doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(extras, labelX + 18, doc.y, { width: 477 });
    doc.moveDown(0.8);
  });

  // Procedures: done here, not dispensed - so apart from the drugs, each with its note.
  const procedures = input.procedures ?? [];
  if (procedures.length) {
    if (doc.y > doc.page.maxY() - 140) continuePage();
    rule();
    doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND_TEAL_DARK).text('Procedures', labelX, doc.y);
    doc.moveDown(0.4);
    procedures.forEach((p, index) => {
      if (doc.y > doc.page.maxY() - 120) continuePage();
      doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(`${index + 1}.  ${p.name}`, labelX, doc.y, { width: 495 });
      if (p.notes) doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(p.notes, labelX + 18, doc.y, { width: 477 });
      doc.moveDown(0.6);
    });
  }

  // Signature lines sit clear of the footer; add a page if the list ran long.
  if (doc.y > doc.page.maxY() - 150) continuePage();
  doc.moveDown(1.5);
  drawSignatures(doc, [
    { label: 'Prescriber - signature', signer: input.prescriberName ? { name: input.prescriberName, role: input.prescriberRole ?? 'Prescriber' } : null },
    { label: 'Dispensed by - name, signature and date' },
  ]);

  await finishDocument(doc, input);
  return done;
}

/** A blood count's cell lines: white cells, red cells, platelets. */
const isCellLine = (name: string) => /^(WBC|RBC|PLT)$/i.test(name.trim());

/** What a page of results is called: lab, imaging, or both. */
const resultsKind = (labs: number, imaging: number) => (imaging && labs ? 'Laboratory and imaging results' : imaging ? 'Imaging results' : 'Laboratory results');

const labReference = (v: { low: number | null; high: number | null; normal: string | null }) =>
  v.low !== null && v.high !== null ? `(${v.low} - ${v.high})` : v.high !== null ? `(< ${v.high})` : v.low !== null ? `(> ${v.low})` : v.normal ?? '';

export type LabResultsPdfInput = SampleOption & {
  clinicName: string;
  facilityCode: string;
  clinicPhone?: string | null;
  clinicLogo?: Buffer | null;
  clinicMotto?: string | null;
  patientName: string;
  patientNumber?: string | null;
  patientPhone?: string | null;
  patientSex?: string | null;
  patientAge?: string;
  tests: Array<{
    id: string; testName: string; results: string; orderedBy: string; requestedAt: Date;
    /** Entered value by value: printed as a table with reference ranges and flags. */
    values?: Array<{ name: string; value: string; unit: string | null; low: number | null; high: number | null; normal: string | null; flag: 'H' | 'L' | 'A' | null }> | null;
    comment?: string | null;
    resultedBy?: Signer | null; resultedAt?: Date | null; verifiedBy?: Signer | null; verifiedAt?: Date | null;
  }>;
  /** Imaging reports printed with the lab results (an ECG, a scan...). */
  imaging?: Array<{ examination: string; modality: string; findings: string | null; impression: string | null; requestedBy: string; requestedAt: Date; reportedBy?: Signer | null; reportedAt?: Date | null }>;
};

/**
 * A patient's laboratory results, to take away: who the patient is, then each
 * test with its result as the lab recorded it, who entered it and who verified
 * it. A result not yet verified by a clinician is printed, clearly marked as
 * preliminary, so a patient who came for tests alone can leave with them.
 */
export async function generateLabResultsPdf(input: LabResultsPdfInput): Promise<Buffer> {
  const imaging = input.imaging ?? [];
  const lastAsked = [...input.tests.map((t) => t.requestedAt), ...imaging.map((r) => r.requestedAt)].sort((a, b) => b.getTime() - a.getTime())[0];
  const { doc, done } = newDocument(documentTitle(resultsKind(input.tests.length, imaging.length), input.patientName, lastAsked));
  drawLetterhead(doc, facilityLetterhead({ name: input.clinicName, facilityCode: input.facilityCode, phone: input.clinicPhone, motto: input.clinicMotto, logo: input.clinicLogo }));
  const L = 50;
  const W = 495;

  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text(resultsKind(input.tests.length, imaging.length).toUpperCase(), L);
  doc.moveDown(0.5);

  // Who the patient is, in two columns to leave the page for the results.
  const sexAge = [input.patientSex ? input.patientSex.charAt(0) + input.patientSex.slice(1).toLowerCase() : '', input.patientAge].filter(Boolean).join(', ');
  const requested = [...input.tests.map((t) => t.requestedAt), ...imaging.map((r) => r.requestedAt)];
  const first = requested.reduce((min, d) => (d < min ? d : min), requested[0] ?? new Date());
  const requesters = [...new Set([...input.tests.map((t) => t.orderedBy), ...imaging.map((r) => r.requestedBy)].filter(Boolean))].join(', ');
  const halves: Array<Array<[string, string | null | undefined]>> = [
    [['Patient', input.patientName], ['Patient ID', input.patientNumber], ['Age / sex', sexAge || '-']],
    [['Phone', input.patientPhone], ['Requested', documentDate(first)], ['Requested by', requesters]],
  ];
  const blockTop = doc.y;
  let blockBottom = blockTop;
  halves.forEach((rows, col) => {
    const x = col === 0 ? L : 310;
    let y = blockTop;
    for (const [label, value] of rows) {
      if (!value) continue;
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(label, x, y, { width: 72, lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(value, x + 74, y, { width: col === 0 ? 180 : 161 });
      y = Math.max(y + 13, doc.y + 2);
    }
    blockBottom = Math.max(blockBottom, y);
  });
  doc.y = blockBottom + 4;

  const pageEnd = () => doc.page.maxY() - 70;
  const continuePage = () => {
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text(`Results for ${input.patientName} (continued)`, L, 50, { width: W });
    doc.y = 72;
  };
  const rule = () => {
    doc.strokeColor('#e2e8f0').lineWidth(0.8).moveTo(L, doc.y).lineTo(L + W, doc.y).stroke();
  };
  const statusOf = (verified: boolean) => ({ text: verified ? 'Verified' : 'Preliminary', color: verified ? BRAND_TEAL : '#b45309' });
  const flagWord = (f: 'H' | 'L' | 'A' | null) => (f ? ({ H: 'High', L: 'Low', A: 'Abnormal' } as const)[f] : '');
  const sectionTitle = (title: string, right: { text: string; color: string }) => {
    if (doc.y > pageEnd() - 50) continuePage();
    doc.moveDown(0.6);
    rule();
    doc.moveDown(0.4);
    const top = doc.y;
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(BRAND_TEAL_DARK).text(title, L, top, { width: 380 });
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(right.color).text(right.text.toUpperCase(), L + 330, top + 2, { width: 165, align: 'right' });
    doc.y = Math.max(doc.y, top + 13);
  };

  // Short results (one value, or a line of text - B/S, RBS, RDTs...) share one table, so several fit on a page.
  const isShort = (t: LabResultsPdfInput['tests'][number]) => (t.values?.length ?? 0) === 1 || (!t.values?.length && t.results.trim().length <= 140 && !t.results.includes('\n'));
  const short = input.tests.filter(isShort);
  const panels = input.tests.filter((t) => !isShort(t));

  if (short.length) {
    sectionTitle(short.length === 1 ? 'Result' : 'Results', { text: '', color: MUTED });
    const cols = [{ x: L, w: 150, t: 'Test' }, { x: 200, w: 110, t: 'Result' }, { x: 310, w: 48, t: 'Flag' }, { x: 358, w: 80, t: 'Reference' }, { x: 438, w: 55, t: 'Units' }, { x: 493, w: 52, t: 'Status' }];
    const header = () => {
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED);
      for (const c of cols) doc.text(c.t, c.x, y, { width: c.w - 4, lineBreak: false });
      doc.y = y + 11;
    };
    header();
    for (const t of short) {
      const v = t.values?.length === 1 ? t.values[0] : null;
      // A text result runs across the result, flag, reference and units columns.
      const resultWidth = v ? cols[1].w - 4 : 290;
      const resultText = v ? v.value : t.results.trim();
      doc.font('Helvetica').fontSize(9);
      const h = Math.max(doc.heightOfString(t.testName, { width: cols[0].w - 4 }), doc.heightOfString(resultText, { width: resultWidth })) + 4;
      if (doc.y + h > pageEnd()) {
        continuePage();
        header();
      }
      const y = doc.y;
      const flagged = !!v?.flag;
      const st = statusOf(!!t.verifiedAt);
      doc.font('Helvetica').fontSize(9).fillColor(INK).text(t.testName, cols[0].x, y, { width: cols[0].w - 4 });
      doc.font(flagged ? 'Helvetica-Bold' : 'Helvetica').fillColor(flagged ? '#b91c1c' : INK).text(resultText, cols[1].x, y, { width: resultWidth });
      if (v) {
        doc.font(flagged ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(flagged ? '#b91c1c' : MUTED).text(flagWord(v.flag) || (v.low !== null || v.high !== null || v.normal ? 'Normal' : ''), cols[2].x, y, { width: cols[2].w - 4, lineBreak: false });
        doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(labReference(v), cols[3].x, y, { width: cols[3].w - 4, lineBreak: false, ellipsis: true });
        doc.text(v.unit ?? '', cols[4].x, y, { width: cols[4].w - 4, lineBreak: false, ellipsis: true });
      }
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(st.color).text(st.text, cols[5].x, y + 1, { width: cols[5].w, lineBreak: false });
      doc.y = y + h;
      if (t.comment) {
        doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(INK).text(`Comment: ${t.comment}`, cols[1].x, doc.y, { width: 295 });
        doc.moveDown(0.2);
      }
    }
  }

  // A test with several values (a blood count, kidney or liver tests): its own table, in tight rows.
  for (const test of panels) {
    sectionTitle(test.testName, statusOf(!!test.verifiedAt));
    if (test.values?.length) {
      const cols = [{ x: L, w: 165, t: 'Parameter' }, { x: 215, w: 80, t: 'Result' }, { x: 295, w: 60, t: 'Flag' }, { x: 355, w: 105, t: 'Reference' }, { x: 460, w: 85, t: 'Units' }];
      const header = () => {
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED);
        for (const c of cols) doc.text(c.t, c.x, y, { width: c.w - 4, lineBreak: false });
        doc.y = y + 10;
      };
      header();
      test.values.forEach((v, index) => {
        if (doc.y > pageEnd()) {
          continuePage();
          header();
        }
        // The cell lines of a blood count (WBC, RBC, PLT) stand out, as on the analyser's
        // printout, each starting its group: the eye finds its place along the rows.
        const cellLine = isCellLine(v.name);
        if (cellLine && index > 0) doc.y += 3;
        const y = doc.y;
        const flagged = !!v.flag;
        const cells = [v.name, v.value, flagWord(v.flag) || (v.low !== null || v.high !== null || v.normal ? 'Normal' : ''), labReference(v), v.unit ?? ''];
        cells.forEach((cell, i) => {
          const red = flagged && (i === 1 || i === 2);
          const bold = red || (cellLine && i !== 2);
          doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(red ? '#b91c1c' : i === 2 ? MUTED : INK).text(cell, cols[i].x, y, { width: cols[i].w - 4, lineBreak: false, ellipsis: true });
        });
        doc.y = y + 10.2;
      });
      if (test.comment) doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(INK).text(`Comment: ${test.comment}`, L, doc.y + 2, { width: W });
    } else {
      doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(test.results.trim(), L, doc.y, { width: W });
    }
  }

  // Imaging: the examination, what was seen, and the conclusion.
  for (const r of imaging) {
    sectionTitle(`${r.examination} (${r.modality})`, { text: 'Reported', color: BRAND_TEAL });
    if (r.findings) {
      if (doc.y > pageEnd() - 30) continuePage();
      doc.font('Helvetica').fontSize(9).fillColor(INK).text(r.findings.trim(), L, doc.y, { width: W });
    }
    if (r.impression) {
      if (doc.y > pageEnd() - 20) continuePage();
      doc.moveDown(0.2);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(`Impression: ${r.impression.trim()}`, L, doc.y, { width: W });
    }
  }

  // Who entered, verified and reported - once, not under every test.
  const named = (people: Array<Signer | null | undefined>) => [...new Map(people.filter((p): p is Signer => !!p).map((p) => [p.name, `${p.name} (${p.role})`])).values()].join(', ');
  const times = [...input.tests.map((t) => t.resultedAt), ...imaging.map((r) => r.reportedAt)].filter((d): d is Date => !!d);
  const latest = times.reduce<Date | null>((max, d) => (!max || d > max ? d : max), null);
  const accountable = [
    named(input.tests.map((t) => t.resultedBy)) && `Results entered by ${named(input.tests.map((t) => t.resultedBy))}`,
    named(input.tests.map((t) => t.verifiedBy)) && `verified by ${named(input.tests.map((t) => t.verifiedBy))}`,
    named(imaging.map((r) => r.reportedBy)) && `imaging reported by ${named(imaging.map((r) => r.reportedBy))}`,
  ].filter(Boolean).join('; ');
  if (doc.y > pageEnd() - 40) continuePage();
  doc.moveDown(0.6);
  rule();
  doc.moveDown(0.4);
  if (accountable) doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`${accountable}${latest ? `. Last result ${documentDateTime(latest)}` : ''}.`, L, doc.y, { width: W });
  if (input.tests.some((t) => !t.verifiedAt)) {
    doc.font('Helvetica-Oblique').fontSize(8).fillColor(MUTED)
      .text('A preliminary result has not yet been checked by a clinician and may be corrected. Discuss your results with the clinician who requested them.', L, doc.y + 2, { width: W });
  }

  // Compact signature lines (name and role on one line), so the results keep to one page.
  if (doc.y > pageEnd() - 26) continuePage();
  const lastEntered = input.tests.find((t) => t.resultedBy)?.resultedBy ?? imaging.find((r) => r.reportedBy)?.reportedBy ?? null;
  const lastVerified = input.tests.find((t) => t.verifiedBy)?.verifiedBy ?? null;
  const sigY = doc.y + 6;
  [
    { x: L, w: 220, label: input.tests.length ? 'Laboratory - signature' : 'Reported by - signature', signer: lastEntered },
    { x: 310, w: 235, label: 'Verified by - signature', signer: lastVerified },
  ].forEach((line) => {
    doc.strokeColor(MUTED).lineWidth(0.5).moveTo(line.x, sigY + 14).lineTo(line.x + line.w, sigY + 14).stroke();
    if (line.signer) doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text(`${line.signer.name}, ${line.signer.role}`, line.x, sigY + 17, { width: line.w, lineBreak: false, ellipsis: true });
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(line.label, line.x, sigY + 28, { width: line.w, lineBreak: false });
  });

  await finishDocument(doc, input);
  return done;
}

// --- Clinical letters (referral letter, discharge summary) ---------------------

type LetterSection = { heading: string; body: string | null | undefined };

/** A new A4 document, titled so a browser names its tab (and a saved copy) after it, not a random address. */
function newDocument(title?: string): { doc: PDFKit.PDFDocument; done: Promise<Buffer> } {
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true, displayTitle: !!title, info: { Title: title ?? 'Bulamu', Author: 'Bulamu', Creator: 'Bulamu - bulamu.site' } });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  return { doc, done };
}

// Title, a details table, then free-text sections - each kept off the footer and
// with a "continued" header naming the patient if it runs onto another page.
async function drawClinicalLetter(input: SampleOption & {
  clinicName: string;
  facilityCode?: string;
  clinicPhone?: string | null;
  clinicLogo?: Buffer | null;
  clinicMotto?: string | null;
  title: string;
  reference: string;
  banner?: { text: string; color: string } | null;
  details: Array<[string, string | null | undefined]>;
  sections: LetterSection[];
  patientName: string;
  signatures: [{ label: string; signer?: Signer | null }, { label: string; signer?: Signer | null }];
}): Promise<Buffer> {
  const { doc, done } = newDocument(documentTitle(input.title.charAt(0) + input.title.slice(1).toLowerCase(), input.patientName));
  drawLetterhead(doc, facilityLetterhead({ name: input.clinicName, facilityCode: input.facilityCode, phone: input.clinicPhone, motto: input.clinicMotto, logo: input.clinicLogo }));

  doc.moveDown(1.5);
  doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text(input.title);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`#${input.reference}`);
  if (input.banner) {
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(input.banner.color).text(input.banner.text);
  }
  doc.moveDown(1);

  const labelX = 50;
  const valueX = 185;
  doc.fontSize(10);
  for (const [label, value] of input.details) {
    if (!value) continue;
    const y = doc.y;
    doc.fillColor(MUTED).font('Helvetica').text(label, labelX, y, { width: 130 });
    doc.fillColor(INK).font('Helvetica-Bold').text(value, valueX, y, { width: 360 });
    doc.moveDown(0.45);
  }

  const continuePage = () => {
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED)
      .text(`${input.title} for ${input.patientName} (continued) - #${input.reference.slice(0, 8)}`, labelX, 50, { width: 495 });
    doc.y = 80;
  };

  for (const section of input.sections) {
    if (!section.body) continue;
    if (doc.y > doc.page.maxY() - 120) continuePage();
    doc.moveDown(0.6);
    doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND_TEAL_DARK).text(section.heading, labelX, doc.y);
    doc.moveDown(0.3);
    for (const paragraph of section.body.split(/\n+/)) {
      if (doc.y > doc.page.maxY() - 90) continuePage();
      doc.font('Helvetica').fontSize(10).fillColor(INK).text(paragraph, labelX, doc.y, { width: 495 });
    }
  }

  if (doc.y > doc.page.maxY() - 150) continuePage();
  doc.moveDown(2);
  drawSignatures(doc, input.signatures);

  await finishDocument(doc, input);
  return done;
}

const dateText = (date: Date | null | undefined) => (date ? documentDate(date) : null);

export type ReferralLetterInput = SampleOption & {
  referralId: string;
  fromClinicName: string;
  fromClinicPhone: string | null;
  fromFacilityCode: string;
  fromClinicLogo?: Buffer | null;
  fromClinicMotto?: string | null;
  toClinicName: string;
  urgency: string;
  createdAt: Date;
  referredByName: string | null;
  referredByRole?: string | null;
  patient: { name: string; number?: string | null; sexAge: string | null; phone: string | null; address: string | null; nextOfKin: string | null };
  allergies: string;
  reason: string;
  clinicalSummary: string | null;
  status: string;
  responseNote: string | null;
};

/** The letter the patient carries to the receiving facility. */
export async function generateReferralLetterPdf(input: ReferralLetterInput): Promise<Buffer> {
  const urgent = input.urgency !== 'ROUTINE';
  return drawClinicalLetter({
    clinicName: input.fromClinicName,
    facilityCode: input.fromFacilityCode,
    clinicLogo: input.fromClinicLogo,
    clinicMotto: input.fromClinicMotto,
    clinicPhone: input.fromClinicPhone,
    sample: input.sample,
    producedBy: input.producedBy,
    title: 'REFERRAL LETTER',
    reference: input.referralId,
    banner: urgent ? { text: `${input.urgency === 'EMERGENCY' ? 'EMERGENCY' : 'URGENT'} REFERRAL`, color: '#b91c1c' } : null,
    patientName: input.patient.name,
    details: [
      ['To', input.toClinicName],
      ['From', input.fromClinicName],
      ['Date', dateText(input.createdAt)],
      ['Referred by', input.referredByName],
      ['Patient', input.patient.name],
      ['Patient ID', input.patient.number],
      ['Age / sex', input.patient.sexAge],
      ['Phone', input.patient.phone],
      ['Address', input.patient.address],
      ['Next of kin', input.patient.nextOfKin],
      ['Allergies', input.allergies],
      ['Status', input.status === 'PENDING' ? null : input.status.charAt(0) + input.status.slice(1).toLowerCase()],
    ],
    sections: [
      { heading: 'Reason for referral', body: input.reason },
      { heading: 'Clinical summary', body: input.clinicalSummary },
      { heading: 'Reply from the receiving facility', body: input.responseNote },
    ],
    signatures: [
      { label: 'Referring clinician - signature and stamp', signer: input.referredByName ? { name: input.referredByName, role: input.referredByRole ?? 'Referring clinician' } : null },
      { label: 'Received by - name, signature and date' },
    ],
  });
}

export type DischargeSummaryInput = SampleOption & {
  admissionId: string;
  clinicName: string;
  facilityCode: string;
  clinicPhone?: string | null;
  clinicLogo?: Buffer | null;
  clinicMotto?: string | null;
  patient: { name: string; number?: string | null; sexAge: string | null; phone: string | null };
  ward: string;
  admittedAt: Date;
  dischargedAt: Date;
  attendingDoctor: string | null;
  dischargedBy: string | null;
  dischargedByRole?: string | null;
  admissionReason: string;
  outcome: string;
  dischargeDiagnosis: string | null;
  dischargeSummary: string | null;
  /** Procedures and operations during the stay, one per paragraph. */
  procedures?: string | null;
  followUpInstructions: string | null;
  referredTo: string | null;
  allergies: string;
};

/** The summary the patient takes home (and the next clinician reads). */
export async function generateDischargeSummaryPdf(input: DischargeSummaryInput): Promise<Buffer> {
  const days = Math.max(1, Math.round((input.dischargedAt.getTime() - input.admittedAt.getTime()) / 86400000));
  return drawClinicalLetter({
    clinicName: input.clinicName,
    facilityCode: input.facilityCode,
    clinicLogo: input.clinicLogo,
    clinicMotto: input.clinicMotto,
    clinicPhone: input.clinicPhone,
    sample: input.sample,
    producedBy: input.producedBy,
    title: 'DISCHARGE SUMMARY',
    reference: input.admissionId,
    patientName: input.patient.name,
    details: [
      ['Patient', input.patient.name],
      ['Age / sex', input.patient.sexAge],
      ['Patient ID', input.patient.number],
      ['Phone', input.patient.phone],
      ['Ward', input.ward],
      ['Admitted', dateText(input.admittedAt)],
      ['Discharged', `${dateText(input.dischargedAt)} (${days} day${days === 1 ? '' : 's'})`],
      ['Outcome', input.outcome],
      ['Referred to', input.referredTo],
      ['Attending clinician', input.attendingDoctor],
      ['Discharged by', input.dischargedBy],
      ['Allergies', input.allergies],
    ],
    sections: [
      { heading: 'Reason for admission', body: input.admissionReason },
      { heading: 'Final diagnosis', body: input.dischargeDiagnosis },
      { heading: 'Summary of the stay and treatment', body: input.dischargeSummary },
      { heading: 'Procedures and operations', body: input.procedures },
      { heading: 'Follow-up and medicines to continue at home', body: input.followUpInstructions },
    ],
    signatures: [
      { label: 'Discharging clinician - signature and stamp', signer: input.dischargedBy ? { name: input.dischargedBy, role: input.dischargedByRole ?? 'Clinician' } : null },
      { label: 'Patient / caregiver - signature' },
    ],
  });
}

export type ReceiptPdfInput = SampleOption & {
  paymentId: string;
  clinicName: string;
  facilityCode: string;
  amount: number;
  currency: string;
  paidAt: Date;
  /** The period paid for; when unknown (older payments) only its end is shown. */
  periodStart?: Date | null;
  periodEnd: Date;
  pesapalReference?: string | null;
  /** Cash handed to a Bulamu administrator: who paid, who received it, any receipt-book number. */
  cash?: { paidBy: string; receivedBy: string; reference?: string | null } | null;
  /** Months the payment covers, when more than one. */
  months?: number;
};

/**
 * Bulamu's receipt to a facility for its subscription (or, at zero, for its
 * free trial). Issued by Cruze, which runs Bulamu - unlike the facility's own
 * documents, the facility is the customer here.
 */
export async function generateReceiptPdf(input: ReceiptPdfInput): Promise<Buffer> {
  const { doc, done } = newDocument(documentTitle(input.amount === 0 ? 'Free trial receipt' : 'Subscription receipt', input.clinicName, input.paidAt));

  // A zero-amount receipt is the free-trial receipt issued when a facility is
  // approved - same document, trial wording instead of payment wording.
  const isTrial = input.amount === 0;
  const period = input.periodStart
    ? `${documentDate(input.periodStart)} to ${documentDate(input.periodEnd)}`
    : `Until ${documentDate(input.periodEnd)}`;

  drawLetterhead(doc, { name: 'Bulamu', motto: 'Transforming patient care.', lines: [`Subscriptions - issued by ${COMPANY_NAME}`, 'bulamu.site'] });

  doc.moveDown(2);
  doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text(isTrial ? 'FREE TRIAL RECEIPT' : 'SUBSCRIPTION RECEIPT', 50);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`#${input.paymentId}`);
  doc.moveDown(1.5);

  drawRows(doc, [
    ['Issued by', `${COMPANY_NAME}, for Bulamu`],
    ['Billed to', input.clinicName],
    ['Facility ID', input.facilityCode],
    ...(isTrial
      ? ([
          ['Plan', 'Complimentary 2-week free trial'],
          ['Trial period', period],
        ] as Array<[string, string]>)
      : ([
          ['Plan', input.months && input.months > 1 ? `Bulamu monthly subscription, ${input.months} months` : 'Bulamu monthly subscription'],
          ['Period covered', period],
          ...(input.cash
            ? ([
                // Cash is recorded the moment it is handed over, so the receipt shows the time too.
                ['Paid on', documentDateTime(input.paidAt)],
                ['Payment method', 'Cash'],
                ['Paid by', input.cash.paidBy],
                ['Received by', `${input.cash.receivedBy}, for Bulamu`],
                ['Receipt book number', input.cash.reference],
              ] as Array<[string, string | null | undefined]>)
            : ([
                ['Paid on', documentDate(input.paidAt)],
                ['Payment method', 'Pesapal'],
                ['Paid to', pesapalMerchantName()],
                ['Pesapal reference', input.pesapalReference],
              ] as Array<[string, string | null | undefined]>)),
        ] as Array<[string, string | null | undefined]>)),
  ], 200);

  doc.moveDown(1.5);
  doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
  doc.moveDown(1);

  const amountY = doc.y;
  doc.font('Helvetica').fontSize(11).fillColor(MUTED).text(isTrial ? 'Amount charged' : 'Amount paid', 50, amountY);
  doc.font('Helvetica-Bold').fontSize(22).fillColor(BRAND_TEAL_DARK).text(money(input.currency, input.amount), 50, amountY + 16);
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor('#15803d')
    .text(isTrial ? 'FREE TRIAL' : 'PAID', 0, amountY + 16, { align: 'right', width: doc.page.width - 50 });

  await finishDocument(doc, input);
  return done;
}

export type FinanceReportPdfInput = SampleOption & {
  facilityName: string;
  facilityCode: string;
  facilityPhone?: string | null;
  facilityLogo?: Buffer | null;
  facilityMotto?: string | null;
  /** EAT days, YYYY-MM-DD, both included. */
  from: string;
  to: string;
  /** The day what is still owed was worked out on. */
  asOf: string;
  includes: string;
  categoryLabel?: string | null;
  sections: Array<{
    key: string;
    title: string;
    total: number;
    count: number;
    byCategory: Array<{ label: string; total: number; count: number }>;
    lines: Array<{ date: string; reference: string; name: string; category: string; details: string; amount: number; voided: string | null }>;
  }>;
  net?: number | null;
};

const reportDay = (day: string) => documentDate(new Date(`${day}T12:00:00Z`));

type Column = { header: string; width: number; align?: 'left' | 'right' };

/**
 * A table that runs over as many pages as it needs: the header row repeats
 * under a "continued" line on each new page, and nothing runs into the footer.
 * Rows given as muted (voided lines) print grey.
 */
function drawTable(doc: PDFKit.PDFDocument, columns: Column[], rows: Array<{ cells: string[]; muted?: boolean; bold?: boolean }>, continued: string) {
  const header = () => {
    const y = doc.y;
    let x = 50;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
    for (const col of columns) {
      doc.text(col.header, x, y, { width: col.width - 6, align: col.align ?? 'left' });
      x += col.width;
    }
    doc.y = y + 12;
    doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
    doc.y += 4;
  };
  // Never a header stranded at the foot of a page: start on a new page unless
  // the header and the first rows fit.
  if (doc.y > doc.page.maxY() - 140) {
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text(continued, 50, 50, { width: 495 });
    doc.y = 72;
  }
  header();
  for (const row of rows) {
    if (doc.y > doc.page.maxY() - 90) {
      doc.addPage();
      doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text(continued, 50, 50, { width: 495 });
      doc.y = 72;
      header();
    }
    const y = doc.y;
    let x = 50;
    let bottom = y;
    doc.font(row.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(row.muted ? MUTED : INK);
    row.cells.forEach((cell, i) => {
      const col = columns[i];
      doc.text(cell, x, y, { width: col.width - 6, align: col.align ?? 'left' });
      bottom = Math.max(bottom, doc.y);
      x += col.width;
    });
    doc.y = bottom + 3;
  }
  doc.x = 50;
}

/**
 * A facility's financial report: a summary, then for each section its totals
 * by category and every line. Issued under the facility's own letterhead (and
 * logo) - the figures are the facility's own.
 */
export async function generateFinanceReportPdf(input: FinanceReportPdfInput): Promise<Buffer> {
  const { doc, done } = newDocument(documentTitle('Financial report', input.facilityName) + ` - ${input.from} to ${input.to}`);
  drawLetterhead(doc, facilityLetterhead({ name: input.facilityName, facilityCode: input.facilityCode, phone: input.facilityPhone, motto: input.facilityMotto, logo: input.facilityLogo }));

  doc.moveDown(1);
  doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text('FINANCIAL REPORT', 50);
  doc.moveDown(0.8);
  const period = input.from === input.to ? reportDay(input.from) : `${reportDay(input.from)} to ${reportDay(input.to)}`;
  drawRows(doc, [
    ['Period', period],
    ['Includes', input.categoryLabel ? `${input.includes} - ${input.categoryLabel} only` : input.includes],
    ['Amounts', 'Ugandan shillings (UGX). Voided receipts and expenses are listed but never counted.'],
  ], 150);

  // Summary: one line per section, and what is left when both sides are in.
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(BRAND_TEAL_DARK).text('Summary', 50);
  doc.moveDown(0.4);
  const summary: Array<{ cells: string[]; bold?: boolean }> = input.sections.map((s) => ({
    cells: [s.key === 'outstanding' ? `${s.title} (as of ${reportDay(input.asOf)})` : s.title, String(s.count), s.total.toLocaleString('en-US')],
  }));
  if (input.net !== null && input.net !== undefined) {
    summary.push({ cells: ['Received less paid out', '', input.net.toLocaleString('en-US')], bold: true });
  }
  drawTable(doc, [{ header: '', width: 335 }, { header: 'Lines', width: 60, align: 'right' }, { header: 'Total (UGX)', width: 100, align: 'right' }], summary, 'Financial report (continued)');

  for (const section of input.sections) {
    if (doc.y > doc.page.maxY() - 170) doc.addPage();
    else doc.moveDown(1.2);
    const title = section.key === 'outstanding' ? `${section.title} - as of ${reportDay(input.asOf)}` : section.title;
    doc.font('Helvetica-Bold').fontSize(12).fillColor(BRAND_TEAL_DARK).text(title, 50);
    doc.moveDown(0.4);
    if (section.lines.length === 0) {
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Nothing in this period.', 50);
      continue;
    }

    if (section.byCategory.length > 1) {
      drawTable(
        doc,
        [{ header: section.key === 'income' ? 'Method' : section.key === 'outstanding' ? 'State' : 'Category', width: 335 }, { header: 'Lines', width: 60, align: 'right' }, { header: 'Total (UGX)', width: 100, align: 'right' }],
        [
          ...section.byCategory.map((c) => ({ cells: [c.label, String(c.count), c.total.toLocaleString('en-US')] })),
          { cells: ['Total', String(section.count), section.total.toLocaleString('en-US')], bold: true },
        ],
        `${section.title} (continued)`
      );
      doc.moveDown(0.8);
    }

    const nameHeader = section.key === 'expenses' ? 'Paid to' : section.key === 'income' ? 'Received from' : 'Patient';
    drawTable(
      doc,
      [
        { header: 'Date', width: 62 },
        { header: 'Reference', width: 78 },
        { header: nameHeader, width: 105 },
        { header: 'Details', width: 160 },
        { header: 'Amount', width: 90, align: 'right' },
      ],
      [
        ...section.lines.map((l) => ({
          cells: [
            reportDay(l.date).replace(/ (\d{4})$/, '\n$1'),
            l.reference,
            l.name,
            [(section.byCategory.length > 1 || section.key === 'outstanding') && l.category !== l.details ? l.category : null, l.details, l.voided ? `VOID - ${l.voided}` : null].filter(Boolean).join('\n'),
            l.voided ? `(${l.amount.toLocaleString('en-US')})` : l.amount.toLocaleString('en-US'),
          ],
          muted: !!l.voided,
        })),
        { cells: ['', '', '', 'Total', money('UGX', section.total)], bold: true },
      ],
      `${section.title} (continued)`
    );
  }

  await finishDocument(doc, input);
  return done;
}

export type ClinicalSummaryPdfInput = SampleOption & {
  clinicName: string;
  facilityCode: string;
  clinicPhone?: string | null;
  clinicMotto?: string | null;
  clinicLogo?: Buffer | null;
  summary: {
    patient: { name: string; patientId: string | null; sexAge: string | null; phone: string; allergies: string };
    visits: Array<{
      date: Date; clinician: string | null; complaints: string; history: string | null; vitals: string | null; examination: string | null;
      diagnoses: string[]; labs: Array<{ name: string; status: string; result: string | null }>; imaging?: string[]; treatment: string[]; plan: string | null;
    }>;
    stays: Array<{
      ward: string; admittedAt: Date; dischargedAt: Date | null; reason: string; dischargeDiagnosis: string | null; dischargeSummary: string | null;
      procedures: Array<{ date: Date; title: string; lines: Array<[string, string]> }>;
    }>;
    otherLabs: Array<{ name: string; status: string; result: string | null; at: Date }>;
    otherImaging?: Array<{ at: Date; line: string; findings: string | null }>;
  };
};

/**
 * A patient's clinical summary at the facility - each visit's complaints,
 * history, vital signs, examination, diagnoses, lab results and treatment,
 * then ward stays with procedures and operations - for a clinician to review
 * or to hand on. Every page says whose summary it is.
 */
export async function generateClinicalSummaryPdf(input: ClinicalSummaryPdfInput): Promise<Buffer> {
  const { doc, done } = newDocument(documentTitle('Clinical summary', input.summary.patient.name));
  const { patient, visits, stays, otherLabs } = input.summary;
  const otherImaging = input.summary.otherImaging ?? [];
  drawLetterhead(doc, facilityLetterhead({ name: input.clinicName, facilityCode: input.facilityCode, phone: input.clinicPhone, motto: input.clinicMotto, logo: input.clinicLogo }));

  doc.moveDown(1.5);
  doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text('CLINICAL SUMMARY', 50);
  doc.moveDown(0.8);
  drawRows(doc, [
    ['Patient', patient.name],
    ['Patient ID', patient.patientId],
    ['Age / sex', patient.sexAge],
    ['Phone', patient.phone],
    ['Allergies', patient.allergies],
  ], 170);

  const continuePage = () => {
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED)
      .text(`Clinical summary for ${patient.name}${patient.patientId ? ` (Patient ID ${patient.patientId})` : ''} (continued)`, 50, 50, { width: 495 });
    doc.y = 80;
  };
  const room = (needed: number) => { if (doc.y > doc.page.maxY() - needed) continuePage(); };
  const heading = (text: string) => {
    room(120);
    doc.moveDown(0.8);
    doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(12).fillColor(BRAND_TEAL_DARK).text(text, 50, doc.y, { width: 495 });
    doc.moveDown(0.3);
  };
  const field = (label: string, value: string | null | undefined) => {
    if (!value) return;
    room(70);
    const y = doc.y;
    doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(label, 50, y, { width: 115 });
    doc.font('Helvetica').fontSize(10).fillColor(INK).text(value, 170, y, { width: 375 });
    doc.moveDown(0.35);
  };
  const list = (label: string, items: string[]) => field(label, items.length ? items.map((i, n) => (items.length > 1 ? `${n + 1}. ${i}` : i)).join('\n') : null);

  if (!visits.length && !stays.length && !otherLabs.length && !otherImaging.length) {
    doc.moveDown(1);
    doc.font('Helvetica').fontSize(10).fillColor(MUTED).text('Nothing has been recorded for this patient at this facility yet.', 50);
  }

  for (const visit of visits) {
    heading(`Visit - ${documentDateTime(visit.date)}${visit.clinician ? ` - ${visit.clinician}` : ''}`);
    field('Complaints', visit.complaints);
    field('History', visit.history);
    field('Vital signs', visit.vitals);
    field('Examination', visit.examination);
    list('Diagnosis', visit.diagnoses);
    list('Lab tests', visit.labs.map((l) => `${l.name}: ${l.result ?? l.status}${l.result && l.status !== 'Verified' ? ` (${l.status.toLowerCase()})` : ''}`));
    list('Imaging', visit.imaging ?? []);
    list('Treatment', visit.treatment);
    field('Assessment and plan', visit.plan);
  }

  for (const stay of stays) {
    heading(`Admission - ${stay.ward}, ${documentDate(stay.admittedAt)}${stay.dischargedAt ? ` to ${documentDate(stay.dischargedAt)}` : ' (still admitted)'}`);
    field('Reason', stay.reason);
    for (const p of stay.procedures) {
      field(documentDate(p.date), [p.title, ...p.lines.filter(([label]) => !['Operation', 'Surgeon', 'Anaesthesia'].includes(label) && !(p.title.startsWith('Procedure') && label === 'Procedure')).map(([l, v]) => `${l}: ${v}`)].join('\n'));
    }
    field('Final diagnosis', stay.dischargeDiagnosis);
    field('Discharge summary', stay.dischargeSummary);
  }

  if (otherLabs.length) {
    heading('Other lab tests');
    for (const l of otherLabs) field(documentDate(l.at), `${l.name}: ${l.result ?? l.status}${l.result && l.status !== 'Verified' ? ` (${l.status.toLowerCase()})` : ''}`);
  }

  if (otherImaging.length) {
    heading('Other imaging');
    for (const r of otherImaging) field(documentDate(r.at), [r.line, r.findings].filter(Boolean).join('\n'));
  }

  await finishDocument(doc, input);
  return done;
}

export type TableReportPdfInput = SampleOption & {
  /** The facility's letterhead for its own reports; Bulamu's for the platform's. */
  letterhead: Letterhead;
  title: string;
  subtitle?: string;
  facts: Array<[string, string]>;
  tables: Array<{ title: string; note?: string; columns: Array<{ header: string; width: number; align?: 'left' | 'right' }>; rows: string[][] }>;
};

/**
 * A report made of headline figures and tables - a facility's monthly report,
 * the platform's usage report. Tables run over pages with their headers repeated.
 */
export async function generateTableReportPdf(input: TableReportPdfInput): Promise<Buffer> {
  const { doc, done } = newDocument(input.title);
  drawLetterhead(doc, input.letterhead);
  doc.moveDown(1.2);
  doc.font('Helvetica-Bold').fontSize(17).fillColor(INK).text(input.title, 50);
  if (input.subtitle) doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(input.subtitle, 50);
  doc.moveDown(0.8);
  drawRows(doc, input.facts, 250, 0.45);

  for (const table of input.tables) {
    doc.moveDown(1);
    if (doc.y > doc.page.maxY() - 150) {
      doc.addPage();
      doc.y = 60;
    }
    doc.font('Helvetica-Bold').fontSize(11.5).fillColor(BRAND_TEAL_DARK).text(table.title, 50, doc.y);
    if (table.note) doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(table.note, 50, doc.y, { width: 495 });
    doc.moveDown(0.4);
    if (table.rows.length === 0) {
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Nothing in this period.', 50, doc.y);
      continue;
    }
    drawTable(doc, table.columns, table.rows.map((cells) => ({ cells })), `${input.title} - ${table.title} (continued)`);
  }

  await finishDocument(doc, input);
  return done;
}

/** Bulamu's own letterhead, for the platform's reports. */
export const bulamuLetterhead = (line: string): Letterhead => ({ name: 'Bulamu', motto: 'Transforming patient care.', lines: [line, 'bulamu.site'] });
