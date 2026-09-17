import PDFDocument from 'pdfkit';

const BRAND_TEAL = '#0f766e';
const BRAND_TEAL_DARK = '#0c5f58';
const INK = '#1e293b';
const MUTED = '#64748b';

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
  doc.y = 95;
}

function drawFooter(doc: PDFKit.PDFDocument) {
  const bottom = doc.page.height - 50;
  doc
    .fontSize(8)
    .fillColor(MUTED)
    .text('Bulamu is a product of Cruze Intelligent Systems (U) Ltd.', 50, bottom, {
      align: 'center',
      width: doc.page.width - 100,
    })
    .text(`Generated ${new Date().toLocaleString()}`, 50, bottom + 12, {
      align: 'center',
      width: doc.page.width - 100,
    });
}

export type InvoicePdfInput = {
  invoiceId: string;
  clinicName: string;
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

  drawFooter(doc);
  doc.end();
  return done;
}

export type ReceiptPdfInput = {
  paymentId: string;
  clinicName: string;
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

  drawLetterhead(doc, input.clinicName);

  doc.moveDown(2);
  doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text('SUBSCRIPTION RECEIPT');
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`#${input.paymentId}`);
  doc.moveDown(1.5);

  const labelX = 50;
  const valueX = 200;
  const rows: [string, string][] = [
    ['Facility', input.clinicName],
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
  doc.font('Helvetica').fontSize(11).fillColor(MUTED).text('Amount Paid', labelX, amountY);
  doc
    .font('Helvetica-Bold')
    .fontSize(22)
    .fillColor(BRAND_TEAL_DARK)
    .text(`${input.currency} ${input.amount.toLocaleString()}`, labelX, amountY + 16);

  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor('#15803d')
    .text('PAID', 0, amountY + 16, { align: 'right', width: doc.page.width - 50 });

  drawFooter(doc);
  doc.end();
  return done;
}
