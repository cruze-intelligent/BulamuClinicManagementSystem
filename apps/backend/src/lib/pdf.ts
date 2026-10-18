import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { formatPrescriptionLine } from './clinical';

const BRAND_TEAL = '#0f766e';
const BRAND_TEAL_DARK = '#0c5f58';
const INK = '#1e293b';
const MUTED = '#64748b';
const SITE_URL = 'https://bulamu.site';
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

/**
 * The shared Bulamu letterhead on the first page: the Bulamu mark on the left
 * and, on the right, whoever issues the document - the facility for its own
 * clinical documents and patient invoices, Cruze for subscription receipts.
 * A facility that has added its logo gets it on a white panel at the right.
 * (No approved Bulamu logo image exists yet; the left side is a text mark.)
 */
function drawLetterhead(doc: PDFKit.PDFDocument, issuer: string, issuerLine?: string, logo?: Buffer | null) {
  doc.rect(0, 0, doc.page.width, 70).fill(BRAND_TEAL);

  doc
    .fillColor('#ffffff')
    .font('Helvetica-Bold')
    .fontSize(20)
    .text('Bulamu', 50, 20);

  doc
    .fillColor('#d1fae5')
    .font('Helvetica')
    .fontSize(9)
    .text('PATIENT CARE, ORGANISED.', 50, 44, { characterSpacing: 1 });

  // The issuer's text ends where the logo panel (if any) begins.
  let textRight = doc.page.width - 50;
  if (logo) {
    const box = { w: 120, h: 54 };
    const boxX = doc.page.width - 50 - box.w;
    try {
      doc.roundedRect(boxX, 8, box.w, box.h, 6).fill('#ffffff');
      doc.image(logo, boxX + 6, 8 + 5, { fit: [box.w - 12, box.h - 10], align: 'center', valign: 'center' });
      textRight = boxX - 12;
    } catch {
      // An unreadable image never stops the document - it goes out without it.
    }
  }
  doc
    .fillColor('#ffffff')
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(issuer, 200, issuerLine ? 20 : 26, { align: 'right', width: textRight - 200 });
  if (issuerLine) {
    doc
      .fillColor('#d1fae5')
      .font('Helvetica')
      .fontSize(9)
      .text(issuerLine, 200, 38, { align: 'right', width: textRight - 200 });
  }

  doc.fillColor(INK).font('Helvetica').fontSize(10);
  doc.x = 50;
  doc.y = 95;
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
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text(`Bulamu is a product of ${COMPANY_NAME}. bulamu.site`, textX, topY, { width: textWidth, lineBreak: false })
      .text(`Produced ${generated}`, textX, topY + 11, { width: textWidth, lineBreak: false })
      .text(`Page ${i - start + 1} of ${count}`, textX, topY + 22, { width: textWidth, lineBreak: false });
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

const INVOICE_STATUS: Record<string, string> = { PENDING: 'Unpaid', PAID: 'Paid', CANCELLED: 'Cancelled' };

/**
 * Shared by every document. `producedBy` is whoever generated this copy - a
 * staff member, or for a patient's own download a plain description - and is
 * printed in the footer of every page. `sample` is set only for the sample
 * documents the platform administrator can request.
 */
type SampleOption = { sample?: boolean; producedBy?: Signer | string | null };

export type Signer = { name: string; role: string };

export type InvoicePdfInput = SampleOption & {
  invoiceId: string;
  clinicName: string;
  facilityCode: string;
  clinicPhone?: string | null;
  clinicLogo?: Buffer | null;
  patientName: string;
  patientPhone: string;
  diagnosis: string;
  doctorName?: string;
  amount: number;
  currency?: string;
  status: string;
  createdAt: Date;
  paidAt?: Date | null;
};

/**
 * A facility's bill to its patient. Bulamu only keeps the record: the
 * facility issues it and collects the money, and the invoice says so.
 */
export async function generateInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  const { doc, done } = newDocument();
  const currency = input.currency ?? 'UGX';
  drawLetterhead(doc, input.clinicName, `Facility ID ${input.facilityCode}`, input.clinicLogo);

  doc.moveDown(2);
  doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text('INVOICE', 50);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`#${input.invoiceId}`);
  doc.moveDown(1.5);

  drawRows(doc, [
    ['Issued by', `${input.clinicName}${input.clinicPhone ? ` - ${input.clinicPhone}` : ''}`],
    ['Patient', input.patientName],
    ['Phone', input.patientPhone || '-'],
    ['For', `Consultation - ${input.diagnosis}`],
    ['Attending clinician', input.doctorName || '-'],
    ['Invoice date', documentDate(input.createdAt)],
    ['Status', INVOICE_STATUS[input.status] ?? input.status],
    ['Paid on', input.paidAt ? documentDate(input.paidAt) : null],
  ], 170);

  doc.moveDown(1.5);
  doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
  doc.moveDown(1);

  const paid = input.status === 'PAID';
  const cancelled = input.status === 'CANCELLED';
  const amountY = doc.y;
  doc.font('Helvetica').fontSize(11).fillColor(MUTED).text(paid ? 'Amount paid' : cancelled ? 'Amount (cancelled)' : 'Amount due', 50, amountY);
  doc.font('Helvetica-Bold').fontSize(22).fillColor(BRAND_TEAL_DARK).text(money(currency, input.amount), 50, amountY + 16);
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(paid ? '#15803d' : cancelled ? MUTED : '#b45309')
    .text((INVOICE_STATUS[input.status] ?? input.status).toUpperCase(), 0, amountY + 16, { align: 'right', width: doc.page.width - 50 });

  doc.moveDown(2.5);
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

export type PrescriptionPdfInput = SampleOption & {
  consultationId: string;
  clinicName: string;
  facilityCode: string;
  clinicLogo?: Buffer | null;
  patientName: string;
  patientPhone: string;
  patientSex?: string | null;
  patientAge?: string;
  prescriberName?: string;
  /** The prescriber's role, as written on the document (e.g. "Doctor / Clinical Officer"). */
  prescriberRole?: string;
  date: Date;
  diagnoses: Array<{ icd10Code: string | null; description: string; type: string; certainty: string; notes: string | null }>;
  prescriptions: Array<{
    medication: string; strength: string | null; form: string | null; dosage: string; route: string | null;
    frequency: string; duration: string; quantity: number | null; instructions: string | null;
  }>;
};

/**
 * A prescription laid out the way a pharmacist expects to read one: who it is
 * for (with age and sex - doses depend on them), why, then each numbered item
 * with the drug on one line and its directions in plain words beneath, and
 * signature lines for the prescriber and the dispenser.
 */
export async function generatePrescriptionPdf(input: PrescriptionPdfInput): Promise<Buffer> {
  const { doc, done } = newDocument();

  drawLetterhead(doc, input.clinicName, `Facility ID ${input.facilityCode}`, input.clinicLogo);

  doc.moveDown(1.5);
  doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text('PRESCRIPTION');
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`#${input.consultationId}`);
  doc.moveDown(1);

  const labelX = 50;
  const valueX = 170;
  const sexAge = [input.patientSex ? input.patientSex.charAt(0) + input.patientSex.slice(1).toLowerCase() : '', input.patientAge].filter(Boolean).join(', ');
  const details: [string, string][] = [
    ['Patient', input.patientName],
    ['Age / sex', sexAge || '-'],
    ['Phone', input.patientPhone || '-'],
    ['Date', documentDate(input.date)],
    ['Prescriber', input.prescriberName || '-'],
    ['Facility ID', input.facilityCode],
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

  rule();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND_TEAL_DARK).text('Diagnosis', labelX, doc.y);
  doc.moveDown(0.3);
  for (const d of input.diagnoses) {
    const code = d.icd10Code ? ` (${d.icd10Code})` : '';
    const status = d.certainty === 'PROVISIONAL' ? ' - provisional' : '';
    const role = d.type === 'PRIMARY' ? 'Primary: ' : 'Also: ';
    doc.font('Helvetica').fontSize(10).fillColor(INK).text(`${role}${d.description}${code}${status}`, labelX, doc.y, { width: 495 });
  }

  rule();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND_TEAL_DARK).text('Rx', labelX, doc.y);
  doc.moveDown(0.4);

  // A continuation page always says whose prescription it is - a loose page must
  // never be separable from its patient.
  const continuePage = () => {
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED)
      .text(`Prescription for ${input.patientName} (continued) - #${input.consultationId.slice(0, 8)}`, labelX, 50, { width: 495 });
    doc.y = 80;
  };

  input.prescriptions.forEach((rx, index) => {
    const line = formatPrescriptionLine(rx);
    // Keep an item's lines together: start a new page rather than split one across pages.
    if (doc.y > doc.page.maxY() - 140) continuePage();
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(`${index + 1}.  ${line.title}`, labelX, doc.y, { width: 495 });
    doc.font('Helvetica').fontSize(10).fillColor(INK);
    if (line.sig) doc.text(line.sig, labelX + 18, doc.y, { width: 477 });
    const extras = [line.quantity, line.instructions].filter(Boolean).join('   |   ');
    if (extras) doc.fillColor(MUTED).text(extras, labelX + 18, doc.y, { width: 477 });
    doc.moveDown(0.8);
  });

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

// --- Clinical letters (referral letter, discharge summary) ---------------------

type LetterSection = { heading: string; body: string | null | undefined };

function newDocument(): { doc: PDFKit.PDFDocument; done: Promise<Buffer> } {
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
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
  clinicLogo?: Buffer | null;
  title: string;
  reference: string;
  banner?: { text: string; color: string } | null;
  details: Array<[string, string | null | undefined]>;
  sections: LetterSection[];
  patientName: string;
  signatures: [{ label: string; signer?: Signer | null }, { label: string; signer?: Signer | null }];
}): Promise<Buffer> {
  const { doc, done } = newDocument();
  drawLetterhead(doc, input.clinicName, input.facilityCode ? `Facility ID ${input.facilityCode}` : undefined, input.clinicLogo);

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
  toClinicName: string;
  urgency: string;
  createdAt: Date;
  referredByName: string | null;
  referredByRole?: string | null;
  patient: { name: string; sexAge: string | null; phone: string | null; address: string | null; nextOfKin: string | null };
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
    sample: input.sample,
    producedBy: input.producedBy,
    title: 'REFERRAL LETTER',
    reference: input.referralId,
    banner: urgent ? { text: `${input.urgency === 'EMERGENCY' ? 'EMERGENCY' : 'URGENT'} REFERRAL`, color: '#b91c1c' } : null,
    patientName: input.patient.name,
    details: [
      ['To', input.toClinicName],
      ['From', `${input.fromClinicName} (${input.fromFacilityCode})${input.fromClinicPhone ? ` - ${input.fromClinicPhone}` : ''}`],
      ['Date', dateText(input.createdAt)],
      ['Referred by', input.referredByName],
      ['Patient', input.patient.name],
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
  clinicLogo?: Buffer | null;
  patient: { name: string; sexAge: string | null; phone: string | null };
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
    sample: input.sample,
    producedBy: input.producedBy,
    title: 'DISCHARGE SUMMARY',
    reference: input.admissionId,
    patientName: input.patient.name,
    details: [
      ['Patient', input.patient.name],
      ['Age / sex', input.patient.sexAge],
      ['Phone', input.patient.phone],
      ['Facility ID', input.facilityCode],
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
};

/**
 * Bulamu's receipt to a facility for its subscription (or, at zero, for its
 * free trial). Issued by Cruze, which runs Bulamu - unlike the facility's own
 * documents, the facility is the customer here.
 */
export async function generateReceiptPdf(input: ReceiptPdfInput): Promise<Buffer> {
  const { doc, done } = newDocument();

  // A zero-amount receipt is the free-trial receipt issued when a facility is
  // approved - same document, trial wording instead of payment wording.
  const isTrial = input.amount === 0;
  const period = input.periodStart
    ? `${documentDate(input.periodStart)} to ${documentDate(input.periodEnd)}`
    : `Until ${documentDate(input.periodEnd)}`;

  drawLetterhead(doc, COMPANY_NAME, 'Bulamu subscriptions - bulamu.site');

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
          ['Plan', 'Bulamu monthly subscription'],
          ['Period covered', period],
          ['Paid on', documentDate(input.paidAt)],
          ['Payment method', 'Pesapal'],
          ['Pesapal reference', input.pesapalReference],
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
