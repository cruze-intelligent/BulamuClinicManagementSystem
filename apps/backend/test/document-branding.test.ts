import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  generateDischargeSummaryPdf, generateInvoicePdf, generatePrescriptionPdf, generateReceiptPdf, generateReferralLetterPdf,
} from '../src/lib/pdf';
import { buildSampleDocuments } from '../src/lib/sample-documents';
import { pdfImageCount, pdfPages, pdfText } from './pdf-text';

// A fixed moment late in the evening UTC: in Kampala (UTC+3) it is already the
// next day, so a document printing the server's UTC date would show the 13th.
const WHEN = new Date('2026-10-13T22:30:00Z');
const STAFF = { name: 'Grace Nankya', role: 'Administrator' };

// Documents are 'produced' now: freeze now at WHEN so the footer's date is checked too.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(WHEN);
});
afterAll(() => {
  vi.useRealTimers();
});

const invoice = (extra: Partial<Parameters<typeof generateInvoicePdf>[0]> = {}) => generateInvoicePdf({
  invoiceId: 'inv-1', clinicName: 'Mbarara Family Clinic', facilityCode: 'BLM-MBR123', clinicPhone: '0772 111 222',
  patientName: 'Achieng Mary', patientPhone: '0700 000 001', diagnosis: 'Malaria', doctorName: 'Dr Okello',
  amount: 25000, status: 'PENDING', createdAt: WHEN, producedBy: STAFF, ...extra,
});

const prescription = (items = 2) => generatePrescriptionPdf({
  consultationId: 'consultation-0001', clinicName: 'Mbarara Family Clinic', facilityCode: 'BLM-MBR123',
  patientName: 'Achieng Mary', patientPhone: '0700', prescriberName: 'Dr Okello', prescriberRole: 'Doctor / Clinical Officer', date: WHEN,
  diagnoses: [{ icd10Code: 'B54', description: 'Malaria', type: 'PRIMARY', certainty: 'CONFIRMED', notes: null }],
  prescriptions: Array.from({ length: items }, (_, i) => ({ medication: `Medicine ${i + 1}`, strength: '500 mg', form: 'tablet', dosage: '1', route: 'oral', frequency: 'twice daily', duration: '5 days', quantity: 10, instructions: null })),
  producedBy: STAFF,
});

const referral = () => generateReferralLetterPdf({
  referralId: 'referral-0001', fromClinicName: 'Mbarara Family Clinic', fromClinicPhone: '0772', fromFacilityCode: 'BLM-MBR123',
  toClinicName: 'Mbarara Regional Referral Hospital', urgency: 'URGENT', createdAt: WHEN,
  referredByName: 'Dr Okello', referredByRole: 'Doctor / Clinical Officer',
  patient: { name: 'Achieng Mary', sexAge: '34 years, Female', phone: '0700', address: null, nextOfKin: null },
  allergies: 'No known allergies', reason: 'Needs transfusion', clinicalSummary: null, status: 'PENDING', responseNote: null,
  producedBy: STAFF,
});

const discharge = () => generateDischargeSummaryPdf({
  admissionId: 'admission-0001', clinicName: 'Mbarara Family Clinic', facilityCode: 'BLM-MBR123',
  patient: { name: 'Achieng Mary', sexAge: '34 years, Female', phone: '0700' }, ward: 'Female Ward',
  admittedAt: new Date(WHEN.getTime() - 3 * 86400000), dischargedAt: WHEN, attendingDoctor: 'Dr Okello',
  dischargedBy: 'Sr Namubiru', dischargedByRole: 'Nurse / Midwife', admissionReason: 'Severe malaria', outcome: 'Discharged - recovered',
  dischargeDiagnosis: null, dischargeSummary: null, followUpInstructions: null, referredTo: null, allergies: 'No known allergies',
  producedBy: 'downloaded by the patient from the Bulamu Patient Portal',
});

const receipt = (amount = 100000) => generateReceiptPdf({
  paymentId: 'payment-1', clinicName: 'Mbarara Family Clinic', facilityCode: 'BLM-MBR123', amount, currency: 'UGX',
  paidAt: WHEN, periodStart: WHEN, periodEnd: new Date(WHEN.getTime() + 30 * 86400000), pesapalReference: amount ? 'PESAPAL-123' : null,
});

describe('every document Bulamu produces is branded the same way', () => {
  const all = () => Promise.all([invoice(), prescription(), referral(), discharge(), receipt(), receipt(0)]);

  it('carries the Bulamu letterhead and, on every page, the footer: maker, site, when, page number', async () => {
    for (const pdf of [...(await all()), await prescription(16)]) {
      const pages = pdfPages(pdf);
      const text = pages.join('\n');
      expect(text).toContain('Bulamu');
      expect(text).toContain('MEDICAL FACILITY OS');
      pages.forEach((page, i) => {
        expect(page).toContain('Bulamu is a product of Cruze Intelligent Systems (U) Ltd. bulamu.site');
        expect(page).toContain('Produced 14 October 2026');
        expect(page).toContain(`Page ${i + 1} of ${pages.length}`);
      });
      // No claim the QR code can't back up.
      expect(text).not.toMatch(/verify/i);
    }
  });

  it('a long prescription runs onto a second page that still says whose it is', async () => {
    const pages = pdfPages(await prescription(16));
    expect(pages).toHaveLength(2);
    expect(pages[1]).toContain('Prescription for Achieng Mary (continued)');
  });

  it('writes every date in Kampala time, day month year - never the server\'s US format', async () => {
    for (const pdf of await all()) {
      const text = pdfText(pdf);
      expect(text).toContain('14 October 2026');
      expect(text).not.toMatch(/\b10\/1[34]\/2026\b/);
      expect(text).not.toContain('13 October 2026');
    }
  });
});

describe('who issues and who signs', () => {
  it("puts the facility at the head of its own documents, and says Bulamu doesn't collect patient payments", async () => {
    for (const pdf of [await invoice(), await prescription(), await referral(), await discharge()]) {
      expect(pdfText(pdf)).toContain('Mbarara Family Clinic');
      expect(pdfText(pdf)).toContain('Facility ID BLM-MBR123');
    }
    const text = pdfText(await invoice());
    expect(text).toContain('Pay the facility directly');
    expect(text).toMatch(/does not\s+collect or hold patient payments/);
    expect(text).toContain('Amount due');
    expect(pdfText(await invoice({ status: 'PAID', paidAt: WHEN }))).toContain('Amount paid');
  });

  it("makes Bulamu's receipts Cruze's, billed to the facility, with the period and the Pesapal reference", async () => {
    const text = pdfText(await receipt());
    expect(text).toContain('Cruze Intelligent Systems (U) Ltd');
    expect(text).toMatch(/Billed to\s*\n?Mbarara Family Clinic/);
    expect(text).toContain('14 October 2026 to 13 November 2026');
    expect(text).toContain('PESAPAL-123');
    const trial = pdfText(await receipt(0));
    expect(trial).toContain('FREE TRIAL RECEIPT');
    expect(trial).toContain('Amount charged');
  });

  it('signs clinical documents with the responsible person\'s name and role', async () => {
    expect(pdfText(await prescription())).toMatch(/Dr Okello\nDoctor \/ Clinical Officer\nPrescriber - signature/);
    expect(pdfText(await referral())).toMatch(/Dr Okello\nDoctor \/ Clinical Officer\nReferring clinician - signature and stamp/);
    expect(pdfText(await discharge())).toMatch(/Sr Namubiru\nNurse \/ Midwife\nDischarging clinician - signature and stamp/);
  });

  it('names who produced each copy in the footer - a member of staff, or the patient\'s own download', async () => {
    expect(pdfText(await invoice())).toContain('by Grace Nankya, Administrator');
    expect(pdfText(await prescription(16)).match(/by Grace Nankya, Administrator/g)).toHaveLength(2);
    expect(pdfText(await discharge())).toContain('downloaded by the patient from the Bulamu Patient Portal');
  });
});

describe('facility logos', () => {
  it("prints the facility's logo on its documents, and documents still work without one", async () => {
    const [sample] = await buildSampleDocuments(WHEN); // the sample invoice carries a placeholder logo
    const withoutLogo = await invoice();
    expect(pdfImageCount(sample.content)).toBeGreaterThan(pdfImageCount(withoutLogo));
  });

  it('never lets an unreadable logo stop a document', async () => {
    const pdf = await invoice({ clinicLogo: Buffer.from('not really an image') });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdfText(pdf)).toContain('Mbarara Family Clinic');
  });
});

describe('sample documents for checking', () => {
  it('builds one of every document, each stamped SAMPLE on every page', async () => {
    const documents = await buildSampleDocuments(WHEN);
    expect(documents.map((d) => d.filename)).toEqual([
      'bulamu-sample-1-invoice-unpaid.pdf', 'bulamu-sample-2-invoice-paid-no-logo.pdf', 'bulamu-sample-3-prescription.pdf',
      'bulamu-sample-4-referral-letter.pdf', 'bulamu-sample-5-discharge-summary.pdf', 'bulamu-sample-6-subscription-receipt.pdf',
      'bulamu-sample-7-free-trial-receipt.pdf',
    ]);
    for (const document of documents) {
      for (const page of pdfPages(document.content)) expect(page).toContain('SAMPLE - NOT A REAL');
    }
  });

  it('never stamps a real document', async () => {
    for (const pdf of [await invoice(), await receipt()]) expect(pdfText(pdf)).not.toContain('SAMPLE');
  });
});
