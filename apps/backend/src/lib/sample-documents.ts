import { deflateSync } from 'zlib';
import {
  generateDischargeSummaryPdf, generateInvoicePdf, generatePatientReceiptPdf, generatePrescriptionPdf, generateReceiptPdf, generateReferralLetterPdf,
} from './pdf';

// One of every document Bulamu produces, filled with plainly made-up details
// and stamped SAMPLE on every page - for the platform administrator to check
// how documents look. Nothing here comes from, or resembles, a real record.

const DAY = 24 * 60 * 60 * 1000;
const FACILITY = { name: 'Sample Health Centre III', code: 'BLM-SAMPLE', phone: '0700 000 000' };

export type SampleDocument = { filename: string; title: string; content: Buffer };

export async function buildSampleDocuments(now: Date = new Date()): Promise<SampleDocument[]> {
  const logo = sampleLogo();
  const patient = { name: 'Jane Sample', phone: '0700 000 001', sexAge: '34 years, Female' };
  const common = { sample: true as const };
  // Facility documents name the staff member who produced the copy; Bulamu's receipts don't.
  const staff = { ...common, producedBy: { name: 'Sample Staff Member', role: 'Administrator' } };

  // A bill as it is itemised today: the visit, a lab test and the medicines.
  const lines = [
    { description: 'Consultation', kind: 'Consultation', quantity: 1, unitPrice: 15000, amount: 15000 },
    { description: 'Malaria RDT', kind: 'Lab test', quantity: 1, unitPrice: 5000, amount: 5000 },
    { description: 'Artemether/Lumefantrine 20/120 mg', kind: 'Medicine', quantity: 24, unitPrice: 250, amount: 6000 },
  ];

  const documents: Array<[string, string, Promise<Buffer>]> = [
    ['1-invoice-unpaid.pdf', 'Patient invoice (facility to patient, part paid) - with the facility logo', generateInvoicePdf({
      ...staff, invoiceId: 'sample-invoice-0001', clinicName: FACILITY.name, facilityCode: FACILITY.code, clinicPhone: FACILITY.phone, clinicLogo: logo,
      patientName: patient.name, patientPhone: patient.phone, diagnosis: 'Malaria, uncomplicated', doctorName: 'Dr Sample Clinician',
      amount: 26000, amountPaid: 10000, status: 'PENDING', createdAt: now, items: lines,
      payments: [{ receiptNumber: '000041', receivedAt: now, method: 'Mobile money', amount: 10000 }],
    })],
    ['2-invoice-paid-no-logo.pdf', 'Patient invoice (paid) - a facility without a logo', generateInvoicePdf({
      ...staff, invoiceId: 'sample-invoice-0002', clinicName: FACILITY.name, facilityCode: FACILITY.code, clinicPhone: FACILITY.phone,
      patientName: patient.name, patientPhone: patient.phone, diagnosis: 'Upper respiratory tract infection', doctorName: 'Dr Sample Clinician',
      amount: 15000, status: 'PAID', createdAt: new Date(now.getTime() - 2 * DAY), paidAt: now,
    })],
    ['3-prescription.pdf', 'Prescription', generatePrescriptionPdf({
      ...staff, consultationId: 'sample-consultation-0001', clinicName: FACILITY.name, facilityCode: FACILITY.code, clinicLogo: logo,
      patientName: patient.name, patientPhone: patient.phone, patientSex: 'FEMALE', patientAge: '34 years', prescriberName: 'Dr Sample Clinician', prescriberRole: 'Doctor / Clinical Officer', date: now,
      diagnoses: [{ icd10Code: 'B54', description: 'Malaria, unspecified', type: 'PRIMARY', certainty: 'CONFIRMED', notes: null }],
      prescriptions: [
        { medication: 'Artemether/Lumefantrine', strength: '20/120 mg', form: 'tablet', dosage: '4 tablets', route: 'oral', frequency: 'twice daily', duration: '3 days', quantity: 24, instructions: 'Take with food' },
        { medication: 'Paracetamol', strength: '500 mg', form: 'tablet', dosage: '2 tablets', route: 'oral', frequency: 'three times daily', duration: '3 days', quantity: 18, instructions: null },
      ],
    })],
    ['4-referral-letter.pdf', 'Referral letter', generateReferralLetterPdf({
      ...staff, referralId: 'sample-referral-0001', fromClinicName: FACILITY.name, fromClinicPhone: FACILITY.phone, fromFacilityCode: FACILITY.code, fromClinicLogo: logo,
      toClinicName: 'Sample Regional Referral Hospital', urgency: 'URGENT', createdAt: now, referredByName: 'Dr Sample Clinician', referredByRole: 'Doctor / Clinical Officer',
      patient: { name: patient.name, sexAge: patient.sexAge, phone: patient.phone, address: 'Sample Village, Sample District', nextOfKin: 'John Sample - 0700 000 002' },
      allergies: 'Penicillin - severe - rash',
      reason: 'Severe anaemia needing blood transfusion, not available at this facility.',
      clinicalSummary: 'Example text only. Presented with fever and weakness for 4 days. Hb 6.2 g/dL. Started on IV artesunate.',
      status: 'PENDING', responseNote: null,
    })],
    ['5-discharge-summary.pdf', 'Discharge summary', generateDischargeSummaryPdf({
      ...staff, admissionId: 'sample-admission-0001', clinicName: FACILITY.name, facilityCode: FACILITY.code, clinicLogo: logo,
      patient: { name: patient.name, sexAge: patient.sexAge, phone: patient.phone }, ward: 'Female Ward, bed 3',
      admittedAt: new Date(now.getTime() - 3 * DAY), dischargedAt: now, attendingDoctor: 'Dr Sample Clinician', dischargedBy: 'Dr Sample Clinician', dischargedByRole: 'Doctor / Clinical Officer',
      admissionReason: 'Severe malaria', outcome: 'Discharged - recovered', dischargeDiagnosis: 'Severe malaria, resolved (B50.9)',
      dischargeSummary: 'Example text only. Completed IV artesunate, then oral treatment. Afebrile for 48 hours.',
      followUpInstructions: 'Complete the oral medicines. Return in 1 week, or sooner if the fever returns.',
      referredTo: null, allergies: 'Penicillin - severe - rash',
    })],
    ['6-subscription-receipt.pdf', 'Subscription receipt (Bulamu to the facility)', generateReceiptPdf({
      ...common, paymentId: 'sample-payment-0001', clinicName: FACILITY.name, facilityCode: FACILITY.code,
      amount: 100000, currency: 'UGX', paidAt: now, periodStart: now, periodEnd: new Date(now.getTime() + 30 * DAY), pesapalReference: 'SAMPLE-PESAPAL-REF',
    })],
    ['7-free-trial-receipt.pdf', 'Free trial receipt (Bulamu to the facility)', generateReceiptPdf({
      ...common, paymentId: 'sample-payment-0002', clinicName: FACILITY.name, facilityCode: FACILITY.code,
      amount: 0, currency: 'UGX', paidAt: now, periodStart: now, periodEnd: new Date(now.getTime() + 14 * DAY),
    })],
    ['8-patient-receipt.pdf', 'Patient receipt (facility to patient, part payment) - with the facility logo', generatePatientReceiptPdf({
      ...staff, receiptNumber: '000041', clinicName: FACILITY.name, facilityCode: FACILITY.code, clinicPhone: FACILITY.phone, clinicLogo: logo,
      patientName: patient.name, patientPhone: patient.phone, amount: 10000, method: 'Mobile money', reference: 'SAMPLE-MOMO-REF', receivedAt: now,
      receivedBy: { name: 'Sample Staff Member', role: 'Front Desk' }, invoiceId: 'sample-invoice-0001', billTotal: 26000, paidToDate: 10000, items: lines,
    })],
  ];

  return Promise.all(documents.map(async ([filename, title, pdf]) => ({ filename: `bulamu-sample-${filename}`, title, content: await pdf })));
}

/** A plain placeholder "logo" (a teal disc and bar), drawn as a PNG. */
function sampleLogo(): Buffer {
  const width = 200;
  const height = 80;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // no filter
    for (let x = 0; x < width; x++) {
      const inDisc = (x - 40) ** 2 + (y - 40) ** 2 <= 30 ** 2;
      const inBar = x >= 82 && x <= 188 && y >= 30 && y <= 50;
      const o = y * (width * 4 + 1) + 1 + x * 4;
      const [r, g, b, a] = inDisc ? [15, 118, 110, 255] : inBar ? [245, 158, 11, 255] : [255, 255, 255, 0];
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed) >>> 0);
  return Buffer.concat([length, typed, crc]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return crc ^ 0xffffffff;
}
