import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { formatPrescriptionLine } from './clinical';

const BRAND_TEAL = '#0f766e';
const BRAND_TEAL_DARK = '#0c5f58';
const INK = '#1e293b';
const MUTED = '#64748b';
const SITE_URL = 'https://bulamu.site';

/**
 * Draws the shared Bulamu letterhead: a placeholder text/color mark (no
 * approved logo asset exists yet - swap the banner block for an image once
 * one does) plus facility name and generation timestamp. Every generated
 * document (invoices today, referral letters / HMIS exports later) starts
 * from this same header so they read as one branded system.
 */
function drawLetterhead(doc: PDFKit.PDFDocument, clinicName: string) {
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
    .text('MEDICAL FACILITY OS', 50, 44, { characterSpacing: 1 });

  doc
    .fillColor('#ffffff')
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(clinicName, 0, 26, { align: 'right', width: doc.page.width - 50 });

  doc.fillColor(INK).font('Helvetica').fontSize(10);
  doc.x = 50;
  doc.y = 95;
}

// Every generated PDF ends with the same footer: a QR code linking back to
// the site (lets anyone holding a printed copy verify it came from Bulamu)
// alongside the standard attribution/timestamp text. QR generation failing
// should never block the document itself from being produced.
async function drawFooter(doc: PDFKit.PDFDocument) {
  // PDFKit auto-inserts a page break for any .text() call whose (y + estimated
  // line height) would land past doc.page.maxY() - even with an explicit y
  // argument. Anchor the whole footer block comfortably above that line
  // (maxY() = page.height - bottom margin) rather than flush against it.
  const topY = doc.page.maxY() - 47;
  const qrSize = 42;
  const textX = 50 + qrSize + 12;
  const textWidth = doc.page.width - 50 - textX;

  try {
    const qrBuffer = await QRCode.toBuffer(SITE_URL, {
      margin: 0,
      width: qrSize,
      color: { dark: BRAND_TEAL, light: '#ffffff' },
    });
    doc.image(qrBuffer, 50, topY, { width: qrSize, height: qrSize });
  } catch {
    // no-op - footer text still renders without the QR code
  }

  doc
    .fontSize(8)
    .fillColor(MUTED)
    .text('Bulamu is a product of Cruze Intelligent Systems (U) Ltd.', textX, topY, { width: textWidth })
    .text('Verify at bulamu.site', textX, topY + 11, { width: textWidth })
    .text(`Generated ${new Date().toLocaleString()}`, textX, topY + 22, { width: textWidth });
}

export type InvoicePdfInput = {
  invoiceId: string;
  clinicName: string;
  facilityCode: string;
  patientName: string;
  patientPhone: string;
  diagnosis: string;
  doctorName?: string;
  amount: number;
  status: string;
  createdAt: Date;
  paidAt?: Date | null;
};

export async function generateInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  drawLetterhead(doc, input.clinicName);

  doc.moveDown(2);
  doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text('INVOICE');
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`#${input.invoiceId}`);
  doc.moveDown(1.5);

  const labelX = 50;
  const valueX = 160;
  const rows: [string, string][] = [
    ['Facility ID', input.facilityCode],
    ['Patient', input.patientName],
    ['Phone', input.patientPhone || '-'],
    ['Diagnosis', input.diagnosis],
    ['Attending clinician', input.doctorName || '-'],
    ['Invoice date', input.createdAt.toLocaleDateString()],
    ['Status', input.status],
  ];
  if (input.paidAt) rows.push(['Paid on', input.paidAt.toLocaleDateString()]);

  doc.fontSize(10);
  for (const [label, value] of rows) {
    const y = doc.y;
    doc.fillColor(MUTED).font('Helvetica').text(label, labelX, y, { width: 100 });
    doc.fillColor(INK).font('Helvetica-Bold').text(value, valueX, y, { width: 380 });
    doc.moveDown(0.6);
  }

  doc.moveDown(1.5);
  doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
  doc.moveDown(1);

  const amountY = doc.y;
  doc.font('Helvetica').fontSize(11).fillColor(MUTED).text('Amount Due', labelX, amountY);
  doc
    .font('Helvetica-Bold')
    .fontSize(22)
    .fillColor(BRAND_TEAL_DARK)
    .text(`UGX ${input.amount.toLocaleString()}`, labelX, amountY + 16);

  const statusColor = input.status === 'PAID' ? '#15803d' : '#b45309';
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(statusColor)
    .text(input.status, 0, amountY + 16, { align: 'right', width: doc.page.width - 50 });

  await drawFooter(doc);
  doc.end();
  return done;
}

export type PrescriptionPdfInput = {
  consultationId: string;
  clinicName: string;
  facilityCode: string;
  patientName: string;
  patientPhone: string;
  patientSex?: string | null;
  patientAge?: string;
  prescriberName?: string;
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
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  drawLetterhead(doc, input.clinicName);

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
    ['Date', input.date.toLocaleDateString()],
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
  const sigY = doc.y;
  doc.strokeColor(MUTED).lineWidth(0.5);
  doc.moveTo(50, sigY + 20).lineTo(250, sigY + 20).stroke();
  doc.moveTo(310, sigY + 20).lineTo(545, sigY + 20).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(MUTED)
    .text('Prescriber signature', 50, sigY + 24)
    .text('Dispensed by / date', 310, sigY + 24);

  await drawFooter(doc);
  doc.end();
  return done;
}

export type ReceiptPdfInput = {
  paymentId: string;
  clinicName: string;
  facilityCode: string;
  amount: number;
  currency: string;
  paidAt: Date;
  periodEnd: Date;
};

export async function generateReceiptPdf(input: ReceiptPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  // A zero-amount receipt is the free-trial receipt issued when a facility is
  // approved - same document, trial wording instead of payment wording.
  const isTrial = input.amount === 0;

  drawLetterhead(doc, input.clinicName);

  doc.moveDown(2);
  doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text(isTrial ? 'FREE TRIAL RECEIPT' : 'SUBSCRIPTION RECEIPT');
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`#${input.paymentId}`);
  doc.moveDown(1.5);

  const labelX = 50;
  const valueX = 200;
  const rows: [string, string][] = isTrial
    ? [
        ['Facility', input.clinicName],
        ['Facility ID', input.facilityCode],
        ['Trial started', input.paidAt.toLocaleDateString()],
        ['Trial ends', input.periodEnd.toLocaleDateString()],
        ['Plan', 'Complimentary 2-week free trial'],
      ]
    : [
        ['Facility', input.clinicName],
        ['Facility ID', input.facilityCode],
        ['Paid on', input.paidAt.toLocaleDateString()],
        ['Subscription period ends', input.periodEnd.toLocaleDateString()],
        ['Payment method', 'Pesapal'],
      ];

  doc.fontSize(10);
  for (const [label, value] of rows) {
    const y = doc.y;
    doc.fillColor(MUTED).font('Helvetica').text(label, labelX, y, { width: 140 });
    doc.fillColor(INK).font('Helvetica-Bold').text(value, valueX, y, { width: 340 });
    doc.moveDown(0.6);
  }

  doc.moveDown(1.5);
  doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
  doc.moveDown(1);

  const amountY = doc.y;
  doc.font('Helvetica').fontSize(11).fillColor(MUTED).text(isTrial ? 'Amount Due' : 'Amount Paid', labelX, amountY);
  doc
    .font('Helvetica-Bold')
    .fontSize(22)
    .fillColor(BRAND_TEAL_DARK)
    .text(`${input.currency} ${input.amount.toLocaleString()}`, labelX, amountY + 16);

  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor('#15803d')
    .text(isTrial ? 'FREE TRIAL' : 'PAID', 0, amountY + 16, { align: 'right', width: doc.page.width - 50 });

  await drawFooter(doc);
  doc.end();
  return done;
}
