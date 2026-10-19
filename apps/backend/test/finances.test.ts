import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';
import { pdfText } from './pdf-text';

const sendMailMock = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/mailer')>();
  return { ...actual, sendMail: sendMailMock };
});

type Role = 'ADMIN' | 'DOCTOR' | 'NURSE' | 'STAFF' | 'PHARMACIST' | 'LAB_TECH';

let app: FastifyInstance;

beforeEach(async () => {
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue({ sent: true, via: 'relay' });
  await resetDb();
  app = await buildTestApp();
});

afterAll(async () => {
  await app?.close();
});

async function staff(clinicId: string, role: Role, name?: string) {
  const { user, password } = await seedUser({ clinicId, role, ...(name ? { name } : {}) });
  return { user, token: (await loginAs(app, user.email, password)).token };
}

/** A facility with its people and one patient who has just been seen: a consultation with a fee, a lab test and a stocked medicine prescribed. */
async function facility(name = 'Mbarara Family Clinic') {
  const clinic = await seedClinic({ name });
  const [admin, doctor, desk, pharmacist, labTech] = await Promise.all([
    staff(clinic.id, 'ADMIN', 'Grace Nankya'),
    staff(clinic.id, 'DOCTOR', 'Dr Okello'),
    staff(clinic.id, 'STAFF', 'Sarah Nakato'),
    staff(clinic.id, 'PHARMACIST', 'Peter Ssali'),
    staff(clinic.id, 'LAB_TECH', 'Joy Atim'),
  ]);
  const patient = await prisma.patient.create({ data: { name: 'Achieng Mary', phone: '0700 000 001', email: 'achieng@example.org', clinicId: clinic.id } });
  const medicine = await prisma.medicine.create({ data: { clinicId: clinic.id, name: 'Amoxicillin 500 mg', quantity: 100, unit: 'capsules', reorderLevel: 10, price: 200 } });
  const appointment = await prisma.appointment.create({ data: { patientId: patient.id, doctorId: doctor.user.id, clinicId: clinic.id, date: new Date(), time: '09:00' } });
  const visit = await app.inject({
    method: 'POST', url: '/consultations', headers: authHeader(doctor.token),
    payload: {
      appointmentId: appointment.id, patientId: patient.id, symptoms: 'Cough', diagnosis: 'Bronchitis', fee: 20000,
      prescriptions: [{ medication: 'Amoxicillin', strength: '500 mg', dosage: '1 capsule', frequency: 'three times daily', duration: '5 days', quantity: 15, medicineId: medicine.id }],
    },
  });
  expect(visit.statusCode).toBe(200);
  const consultation = visit.json().consultation;
  const lab = await prisma.labTest.create({ data: { patientId: patient.id, consultationId: consultation.id, testName: 'Full blood count', results: '', orderedBy: 'Dr Okello' } });
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { consultationId: consultation.id } });
  return { clinic, admin, doctor, desk, pharmacist, labTech, patient, medicine, consultation, lab, invoice };
}

const pay = (token: string, invoiceId: string, payload: object) =>
  app.inject({ method: 'POST', url: `/invoices/${invoiceId}/payments`, headers: authHeader(token), payload });
const detail = async (token: string, invoiceId: string) =>
  (await app.inject({ method: 'GET', url: `/invoices/detail/${invoiceId}`, headers: authHeader(token) })).json();

describe('itemised bills', () => {
  it('opens a bill from the visit fee, suggests the visit\'s lab test and medicine, and adds them as lines', async () => {
    const f = await facility();
    const first = await detail(f.desk.token, f.invoice.id);
    expect(first.invoice.items).toEqual([expect.objectContaining({ kind: 'CONSULTATION', description: 'Consultation', amount: 20000 })]);
    expect(first.invoice.state).toBe('Unpaid');
    // The medicine comes with its stock price and the quantity prescribed; the lab test has no price yet.
    expect(first.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'LAB', description: 'Full blood count', unitPrice: null, labTestId: f.lab.id }),
      expect.objectContaining({ kind: 'MEDICINE', description: 'Amoxicillin 500 mg', quantity: 15, unitPrice: 200 }),
    ]));

    const medicine = first.suggestions.find((s: any) => s.kind === 'MEDICINE');
    const addMedicine = await app.inject({ method: 'POST', url: `/invoices/${f.invoice.id}/items`, headers: authHeader(f.pharmacist.token), payload: medicine });
    expect(addMedicine.statusCode).toBe(200);
    const addLab = await app.inject({
      method: 'POST', url: `/invoices/${f.invoice.id}/items`, headers: authHeader(f.desk.token),
      payload: { kind: 'LAB', description: 'Full blood count', unitPrice: '12,000', labTestId: f.lab.id },
    });
    expect(addLab.statusCode).toBe(200);
    expect(addLab.json().invoice.amount).toBe(20000 + 15 * 200 + 12000);
    expect(addLab.json().invoice.balance).toBe(35000);

    // Nothing is billed twice, and nothing is left to suggest.
    const again = await app.inject({ method: 'POST', url: `/invoices/${f.invoice.id}/items`, headers: authHeader(f.desk.token), payload: { kind: 'LAB', description: 'FBC', unitPrice: 12000, labTestId: f.lab.id } });
    expect(again.statusCode).toBe(409);
    expect((await detail(f.desk.token, f.invoice.id)).suggestions).toEqual([]);

    // Next time, the same test is suggested at the price charged before.
    const later = await prisma.labTest.create({ data: { patientId: f.patient.id, testName: 'Full blood count', results: '', orderedBy: 'Dr Okello' } });
    const walkIn = await app.inject({
      method: 'POST', url: '/invoices', headers: authHeader(f.desk.token),
      payload: { patientId: f.patient.id, items: [{ kind: 'OTHER', description: 'Dressing', unitPrice: 3000 }] },
    });
    expect(walkIn.statusCode).toBe(200);
    expect((await detail(f.desk.token, walkIn.json().invoice.id)).suggestions).toEqual([
      expect.objectContaining({ kind: 'LAB', labTestId: later.id, unitPrice: 12000 }),
    ]);
  });

  it('charges a ward stay by the night: suggests the nights not yet charged, at the price last used for that ward', async () => {
    const f = await facility();
    const ward = await prisma.ward.create({ data: { clinicId: f.clinic.id, name: 'Female Ward', type: 'FEMALE', beds: 10 } });
    const stay = await prisma.admission.create({
      data: { clinicId: f.clinic.id, patientId: f.patient.id, wardId: ward.id, reason: 'Severe malaria', admittedByUserId: f.doctor.user.id, admittedAt: new Date(Date.now() - 50 * 60 * 60 * 1000) },
    });
    const suggested = (await detail(f.desk.token, f.invoice.id)).suggestions.find((s: any) => s.kind === 'ADMISSION');
    expect(suggested).toMatchObject({ description: 'Female Ward - ward stay (per night)', quantity: 3, unitPrice: null, admissionId: stay.id });

    const added = await app.inject({ method: 'POST', url: `/invoices/${f.invoice.id}/items`, headers: authHeader(f.desk.token), payload: { ...suggested, quantity: 2, unitPrice: 15000 } });
    expect(added.json().invoice.amount).toBe(20000 + 30000);
    // One night still to charge, now at the ward's price.
    expect((await detail(f.desk.token, f.invoice.id)).suggestions.find((s: any) => s.kind === 'ADMISSION')).toMatchObject({ quantity: 1, unitPrice: 15000 });

    const other = await prisma.patient.create({ data: { name: 'Someone Else', phone: '0700', clinicId: f.clinic.id } });
    const theirs = await prisma.admission.create({ data: { clinicId: f.clinic.id, patientId: other.id, wardId: ward.id, reason: 'x', admittedByUserId: f.doctor.user.id } });
    const wrong = await app.inject({ method: 'POST', url: `/invoices/${f.invoice.id}/items`, headers: authHeader(f.desk.token), payload: { kind: 'ADMISSION', description: 'Ward', unitPrice: 1000, admissionId: theirs.id } });
    expect(wrong.json().error).toBe("That ward stay isn't this patient's");
  });

  it('checks every charge: a description, a whole positive price, a sensible quantity - and only this patient\'s tests', async () => {
    const f = await facility();
    const add = (payload: object) => app.inject({ method: 'POST', url: `/invoices/${f.invoice.id}/items`, headers: authHeader(f.desk.token), payload });
    expect((await add({ kind: 'LAB', description: '', unitPrice: 1000 })).json().error).toBe('Describe the charge');
    expect((await add({ kind: 'LAB', description: 'X', unitPrice: 0 })).statusCode).toBe(400);
    expect((await add({ kind: 'LAB', description: 'X', unitPrice: 12.5 })).statusCode).toBe(400);
    expect((await add({ kind: 'LAB', description: 'X', unitPrice: 1000, quantity: 0 })).statusCode).toBe(400);
    expect((await add({ kind: 'SPA', description: 'X', unitPrice: 1000 })).statusCode).toBe(400);

    const other = await prisma.patient.create({ data: { name: 'Someone Else', phone: '0700', clinicId: f.clinic.id } });
    const theirs = await prisma.labTest.create({ data: { patientId: other.id, testName: 'HIV test', results: '', orderedBy: 'x' } });
    expect((await add({ kind: 'LAB', description: 'HIV test', unitPrice: 1000, labTestId: theirs.id })).json().error).toBe("That lab test isn't this patient's");
  });

  it('keeps every facility to its own bills and patients', async () => {
    const mine = await facility('Clinic A');
    const theirs = await facility('Clinic B');
    expect((await app.inject({ method: 'GET', url: `/invoices/detail/${theirs.invoice.id}`, headers: authHeader(mine.desk.token) })).statusCode).toBe(403);
    expect((await pay(mine.desk.token, theirs.invoice.id, { amount: 1000, method: 'CASH' })).statusCode).toBe(403);
    const walkIn = await app.inject({ method: 'POST', url: '/invoices', headers: authHeader(mine.desk.token), payload: { patientId: theirs.patient.id, items: [{ kind: 'OTHER', description: 'X', unitPrice: 1000 }] } });
    expect(walkIn.statusCode).toBe(403);
    const list = (await app.inject({ method: 'GET', url: `/invoices/${mine.clinic.id}`, headers: authHeader(mine.desk.token) })).json();
    expect(list.invoices.map((i: any) => i.patient.name)).toEqual(['Achieng Mary']);
    expect(list.invoices[0].clinicId).toBe(mine.clinic.id);
  });

  it('lets the desk, clinicians and the pharmacy handle bills - not the lab - and only an administrator cancel or void', async () => {
    const f = await facility();
    expect((await app.inject({ method: 'GET', url: `/invoices/${f.clinic.id}`, headers: authHeader(f.labTech.token) })).statusCode).toBe(403);
    expect((await pay(f.labTech.token, f.invoice.id, { amount: 1000, method: 'CASH' })).statusCode).toBe(403);
    for (const who of [f.desk, f.doctor, f.pharmacist, f.admin]) {
      expect((await pay(who.token, f.invoice.id, { amount: 1000, method: 'CASH' })).statusCode).toBe(200);
    }
    const payment = await prisma.patientPayment.findFirstOrThrow();
    expect((await app.inject({ method: 'POST', url: `/payments/${payment.id}/void`, headers: authHeader(f.desk.token), payload: { reason: 'Mistake' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: `/invoices/${f.invoice.id}/cancel`, headers: authHeader(f.doctor.token) })).statusCode).toBe(403);
  });
});

describe('payments and receipts', () => {
  it('takes part payments with numbered receipts until the bill is paid in full - never more than is owed', async () => {
    const f = await facility();
    expect((await pay(f.desk.token, f.invoice.id, { amount: 5000 })).json().error).toBe('Choose how the patient paid');
    expect((await pay(f.desk.token, f.invoice.id, { amount: 25000, method: 'CASH' })).json().error).toBe('That is more than the balance of UGX 20,000');

    const first = await pay(f.desk.token, f.invoice.id, { amount: '8,000', method: 'CASH' });
    expect(first.statusCode).toBe(200);
    expect(first.json().payment.receiptNumber).toBe('000001');
    expect(first.json().invoice).toMatchObject({ status: 'PENDING', state: 'Part paid', amountPaid: 8000, balance: 12000, paidAt: null });

    const second = await pay(f.desk.token, f.invoice.id, { amount: 12000, method: 'MOBILE_MONEY', reference: ' MP2610.1432.A71234 ', payerName: 'Okello John' });
    expect(second.json().payment).toMatchObject({ receiptNumber: '000002', method: 'MOBILE_MONEY', reference: 'MP2610.1432.A71234', payerName: 'Okello John' });
    expect(second.json().invoice).toMatchObject({ status: 'PAID', state: 'Paid', balance: 0 });
    expect(second.json().invoice.paidAt).not.toBeNull();
    expect((await pay(f.desk.token, f.invoice.id, { amount: 1, method: 'CASH' })).json().error).toBe('This invoice is already paid');

    // A charge added after paying opens the bill again for just that amount.
    const added = await app.inject({ method: 'POST', url: `/invoices/${f.invoice.id}/items`, headers: authHeader(f.desk.token), payload: { kind: 'PROCEDURE', description: 'Wound dressing', unitPrice: 5000 } });
    expect(added.json().invoice).toMatchObject({ status: 'PENDING', state: 'Part paid', balance: 5000, paidAt: null });

    const audit = await prisma.auditLog.findMany({ where: { entity: 'PatientPayment' } });
    expect(audit).toHaveLength(2);
  });

  it('numbers receipts per facility, with no gaps or repeats even when payments arrive at once', async () => {
    const a = await facility('Clinic A');
    const b = await facility('Clinic B');
    const bills = await Promise.all(Array.from({ length: 6 }, async () => {
      const res = await app.inject({ method: 'POST', url: '/invoices', headers: authHeader(a.desk.token), payload: { patientId: a.patient.id, items: [{ kind: 'OTHER', description: 'Sale', unitPrice: 1000 }] } });
      return res.json().invoice.id;
    }));
    const results = await Promise.all(bills.map((id) => pay(a.desk.token, id, { amount: 1000, method: 'CASH' })));
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(results.map((r) => r.json().payment.receiptNumber).sort()).toEqual(['000001', '000002', '000003', '000004', '000005', '000006']);
    expect((await pay(b.desk.token, b.invoice.id, { amount: 1000, method: 'CASH' })).json().payment.receiptNumber).toBe('000001');

    // Three people taking the whole balance of the same bill at once: one succeeds.
    const race = await Promise.all([a.desk, a.doctor, a.admin].map((who) => pay(who.token, a.invoice.id, { amount: 20000, method: 'CASH' })));
    expect(race.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: a.invoice.id } })).amountPaid).toBe(20000);
  });

  it('voids a payment taken by mistake: kept with the reason, no longer counted, and its receipt says VOID', async () => {
    const f = await facility();
    const taken = (await pay(f.desk.token, f.invoice.id, { amount: 20000, method: 'CASH' })).json().payment;
    expect((await app.inject({ method: 'PATCH', url: `/invoices/${f.invoice.id}/cancel`, headers: authHeader(f.admin.token) })).statusCode).toBe(409);

    expect((await app.inject({ method: 'POST', url: `/payments/${taken.id}/void`, headers: authHeader(f.admin.token), payload: {} })).json().error).toBe('Say why the payment is being voided');
    const voided = await app.inject({ method: 'POST', url: `/payments/${taken.id}/void`, headers: authHeader(f.admin.token), payload: { reason: 'Charged the wrong patient' } });
    expect(voided.statusCode).toBe(200);
    expect(voided.json().invoice).toMatchObject({ status: 'PENDING', state: 'Unpaid', amountPaid: 0, balance: 20000 });
    expect((await app.inject({ method: 'POST', url: `/payments/${taken.id}/void`, headers: authHeader(f.admin.token), payload: { reason: 'again' } })).statusCode).toBe(409);

    const receipt = await app.inject({ method: 'GET', url: `/payments/${taken.id}/receipt/pdf`, headers: authHeader(f.desk.token) });
    expect(receipt.statusCode).toBe(200);
    expect(pdfText(receipt.rawPayload)).toContain('VOID - cancelled on');
    expect(pdfText(receipt.rawPayload)).toContain('Charged the wrong patient');

    // With nothing standing against it, the bill can now be cancelled - and then takes nothing more.
    expect((await app.inject({ method: 'PATCH', url: `/invoices/${f.invoice.id}/cancel`, headers: authHeader(f.admin.token) })).statusCode).toBe(200);
    expect((await pay(f.desk.token, f.invoice.id, { amount: 1000, method: 'CASH' })).json().error).toBe('This invoice was cancelled');
  });

  it('takes a charge off only while the payments still fit, and never the last one', async () => {
    const f = await facility();
    const withExtra = await app.inject({ method: 'POST', url: `/invoices/${f.invoice.id}/items`, headers: authHeader(f.desk.token), payload: { kind: 'OTHER', description: 'Card fee', unitPrice: 5000 } });
    const extra = withExtra.json().invoice.items.find((i: any) => i.description === 'Card fee');
    const consultation = withExtra.json().invoice.items.find((i: any) => i.kind === 'CONSULTATION');
    await pay(f.desk.token, f.invoice.id, { amount: 22000, method: 'CASH' });
    const remove = (itemId: string) => app.inject({ method: 'DELETE', url: `/invoices/${f.invoice.id}/items/${itemId}`, headers: authHeader(f.desk.token) });
    expect((await remove(extra.id)).json().error).toMatch(/void a payment first/);

    const fresh = await facility('Other');
    const added = await app.inject({ method: 'POST', url: `/invoices/${fresh.invoice.id}/items`, headers: authHeader(fresh.desk.token), payload: { kind: 'OTHER', description: 'Extra', unitPrice: 1000 } });
    const extraItem = added.json().invoice.items.find((i: any) => i.description === 'Extra');
    const removed = await app.inject({ method: 'DELETE', url: `/invoices/${fresh.invoice.id}/items/${extraItem.id}`, headers: authHeader(fresh.desk.token) });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().invoice.amount).toBe(20000);
    const last = removed.json().invoice.items[0];
    expect((await app.inject({ method: 'DELETE', url: `/invoices/${fresh.invoice.id}/items/${last.id}`, headers: authHeader(fresh.desk.token) })).json().error).toMatch(/cancel the invoice instead/);
    expect(consultation).toBeTruthy();
  });

  it('prints the receipt with the facility, number, method, who took it and the balance - and emails it to the patient', async () => {
    const f = await facility();
    const taken = (await pay(f.desk.token, f.invoice.id, { amount: 15000, method: 'MOBILE_MONEY', reference: 'MP-123' })).json().payment;
    const pdf = await app.inject({ method: 'GET', url: `/payments/${taken.id}/receipt/pdf`, headers: authHeader(f.desk.token) });
    expect(pdf.headers['content-disposition']).toContain('receipt-000001.pdf');
    const text = pdfText(pdf.rawPayload);
    for (const expected of ['Mbarara Family Clinic', 'No. 000001', 'Mobile money', 'MP-123', 'Sarah Nakato, Front Desk', 'Balance UGX 5,000', 'Achieng Mary']) {
      expect(text).toContain(expected);
    }

    const emailed = await app.inject({ method: 'POST', url: `/payments/${taken.id}/receipt/email`, headers: authHeader(f.desk.token), payload: {} });
    expect(emailed.statusCode).toBe(200);
    expect(emailed.json().to).toBe('achieng@example.org');
    const mail = sendMailMock.mock.calls.at(-1)![0];
    expect(mail.subject).toBe('Your receipt 000001 from Mbarara Family Clinic');
    expect(mail.html).toContain('UGX 15,000');
    expect(mail.html).toContain('UGX 5,000');
    expect(mail.attachments[0]).toMatchObject({ filename: 'receipt-000001.pdf', contentType: 'application/pdf' });

    // Another address can be given; a bad one is refused; a failed send says what to do instead.
    expect((await app.inject({ method: 'POST', url: `/payments/${taken.id}/receipt/email`, headers: authHeader(f.desk.token), payload: { email: 'not-an-email' } })).statusCode).toBe(400);
    sendMailMock.mockResolvedValueOnce({ sent: false, reason: 'down' });
    const failed = await app.inject({ method: 'POST', url: `/payments/${taken.id}/receipt/email`, headers: authHeader(f.desk.token), payload: { email: 'kin@example.org' } });
    expect(failed.statusCode).toBe(502);
    expect(failed.json().error).toMatch(/download it and share it/);
  });

  it('prints the invoice with its lines, payments and balance', async () => {
    const f = await facility();
    await app.inject({ method: 'POST', url: `/invoices/${f.invoice.id}/items`, headers: authHeader(f.desk.token), payload: { kind: 'LAB', description: 'Full blood count', unitPrice: 12000, labTestId: f.lab.id } });
    await pay(f.desk.token, f.invoice.id, { amount: 10000, method: 'CASH' });
    const pdf = await app.inject({ method: 'GET', url: `/invoices/${f.invoice.id}/pdf`, headers: authHeader(f.admin.token) });
    const text = pdfText(pdf.rawPayload);
    expect(text).toContain('Full blood count');
    expect(text).toContain('Receipt 000001');
    expect(text).toContain('PART PAID');
    expect(text).toContain('UGX 22,000');
  });

  it('keeps the older one-button "Mark paid" working: the whole balance as one receipted payment', async () => {
    const f = await facility();
    await pay(f.desk.token, f.invoice.id, { amount: 5000, method: 'CASH' });
    const res = await app.inject({ method: 'PATCH', url: `/invoices/${f.invoice.id}/pay`, headers: authHeader(f.doctor.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().payment).toMatchObject({ amount: 15000, receiptNumber: '000002', method: null });
    expect(res.json().invoice.status).toBe('PAID');
  });

  it('keeps a lump-sum bill\'s amount when a line is added to it', async () => {
    const f = await facility();
    const visit = await prisma.consultation.create({
      data: { appointmentId: (await prisma.appointment.create({ data: { patientId: f.patient.id, doctorId: f.doctor.user.id, clinicId: f.clinic.id, date: new Date(), time: '10:00' } })).id, patientId: f.patient.id, diagnosis: 'Malaria', symptoms: 'Fever' },
    });
    const lump = await prisma.invoice.create({ data: { consultationId: visit.id, patientId: f.patient.id, clinicId: f.clinic.id, amount: 18000 } });
    const res = await app.inject({ method: 'POST', url: `/invoices/${lump.id}/items`, headers: authHeader(f.desk.token), payload: { kind: 'MEDICINE', description: 'Paracetamol', quantity: 10, unitPrice: 50 } });
    expect(res.json().invoice.amount).toBe(18500);
    expect(res.json().invoice.items.map((i: any) => i.description)).toEqual(['Consultation', 'Paracetamol']);
  });

  it('lists bills by state and by patient name, with what is outstanding', async () => {
    const f = await facility();
    const other = await prisma.patient.create({ data: { name: 'Mukasa Joseph', phone: '0701', clinicId: f.clinic.id } });
    const sale = (await app.inject({ method: 'POST', url: '/invoices', headers: authHeader(f.pharmacist.token), payload: { patientId: other.id, items: [{ kind: 'MEDICINE', description: 'ORS', quantity: 4, unitPrice: 500 }] } })).json().invoice;
    await pay(f.pharmacist.token, sale.id, { amount: 2000, method: 'CASH' });
    await pay(f.desk.token, f.invoice.id, { amount: 5000, method: 'CASH' });
    const list = async (query: string) => (await app.inject({ method: 'GET', url: `/invoices/${f.clinic.id}?${query}`, headers: authHeader(f.desk.token) })).json();
    expect((await list('status=PAID')).invoices.map((i: any) => i.patient.name)).toEqual(['Mukasa Joseph']);
    expect((await list('status=PART_PAID')).invoices.map((i: any) => i.patient.name)).toEqual(['Achieng Mary']);
    expect((await list('status=UNPAID')).invoices).toHaveLength(0);
    expect((await list('q=muk')).invoices).toHaveLength(1);
    expect((await list('')).summary).toEqual({ outstanding: 15000, outstandingCount: 1 });
  });
});

describe('daily takings, the month and expenses', () => {
  // 23:30 in Kampala on 17 October is 20:30 UTC - it belongs to the 17th.
  const LATE_ON_THE_17TH = new Date('2026-10-17T20:30:00Z');
  const EARLY_ON_THE_18TH = new Date('2026-10-17T21:30:00Z');

  async function takingsDay() {
    const f = await facility();
    const sale = (await app.inject({ method: 'POST', url: '/invoices', headers: authHeader(f.pharmacist.token), payload: { patientId: f.patient.id, items: [{ kind: 'MEDICINE', description: 'ORS', quantity: 10, unitPrice: 500 }] } })).json().invoice;
    const cash = (await pay(f.desk.token, f.invoice.id, { amount: 12000, method: 'CASH' })).json().payment;
    const momo = (await pay(f.desk.token, f.invoice.id, { amount: 8000, method: 'MOBILE_MONEY', reference: 'MP1' })).json().payment;
    const pharmacy = (await pay(f.pharmacist.token, sale.id, { amount: 5000, method: 'CASH' })).json().payment;
    const mistake = (await pay(f.pharmacist.token, sale.id, { amount: 0 + 1, method: 'CARD' })).json();
    // (The sale was already paid in full, so that last one is refused.)
    expect(mistake.error).toBe('This invoice is already paid');
    await prisma.patientPayment.updateMany({ where: { id: { in: [cash.id, momo.id, pharmacy.id] } }, data: { receivedAt: LATE_ON_THE_17TH } });
    const nextDay = await app.inject({ method: 'POST', url: `/invoices/${f.invoice.id}/items`, headers: authHeader(f.desk.token), payload: { kind: 'OTHER', description: 'Review', unitPrice: 3000 } });
    const tomorrow = (await pay(f.desk.token, nextDay.json().invoice.id, { amount: 3000, method: 'CASH' })).json().payment;
    await prisma.patientPayment.update({ where: { id: tomorrow.id }, data: { receivedAt: EARLY_ON_THE_18TH } });
    // Everything was billed on the 17th too, whatever day the tests run.
    await prisma.invoiceItem.updateMany({ data: { createdAt: LATE_ON_THE_17TH } });
    return f;
  }

  it("totals a day's takings in East Africa Time, by method and by member of staff, with the cash expected in the drawer", async () => {
    const f = await takingsDay();
    await prisma.expense.create({ data: { clinicId: f.clinic.id, category: 'TRANSPORT', description: 'Boda to the lab', amount: 2000, method: 'CASH', spentOn: new Date('2026-10-16T21:00:00Z') } });
    const res = await app.inject({ method: 'GET', url: `/finances/${f.clinic.id}/takings?date=2026-10-17`, headers: authHeader(f.admin.token) });
    expect(res.statusCode).toBe(200);
    const t = res.json().takings;
    expect(t).toMatchObject({ date: '2026-10-17', scope: 'everyone', total: 25000, count: 3, expenses: 2000, cashInHand: 12000 + 5000 - 2000 });
    expect(t.byMethod).toEqual([
      { method: 'CASH', label: 'Cash', total: 17000, count: 2 },
      { method: 'MOBILE_MONEY', label: 'Mobile money', total: 8000, count: 1 },
    ]);
    expect(t.byStaff.map((s: any) => [s.name, s.role, s.total])).toEqual([['Sarah Nakato', 'Front Desk', 20000], ['Peter Ssali', 'Pharmacist', 5000]]);
    expect(t.payments.map((p: any) => p.receiptNumber)).toEqual(['000001', '000002', '000003']);

    const next = (await app.inject({ method: 'GET', url: `/finances/${f.clinic.id}/takings?date=2026-10-18`, headers: authHeader(f.admin.token) })).json().takings;
    expect(next.total).toBe(3000);
  });

  it('shows staff only the money they took themselves, for handing over', async () => {
    const f = await takingsDay();
    const mine = (await app.inject({ method: 'GET', url: `/finances/${f.clinic.id}/takings?date=2026-10-17`, headers: authHeader(f.pharmacist.token) })).json().takings;
    expect(mine).toMatchObject({ scope: 'mine', total: 5000, count: 1 });
    expect(mine.cashInHand).toBeUndefined();
    expect((await app.inject({ method: 'GET', url: `/finances/${f.clinic.id}/takings`, headers: authHeader(f.labTech.token) })).statusCode).toBe(403);
  });

  it('leaves a voided payment out of the totals but lists it', async () => {
    const f = await takingsDay();
    const momo = await prisma.patientPayment.findFirstOrThrow({ where: { method: 'MOBILE_MONEY' } });
    await app.inject({ method: 'POST', url: `/payments/${momo.id}/void`, headers: authHeader(f.admin.token), payload: { reason: 'Reversed by the network' } });
    const t = (await app.inject({ method: 'GET', url: `/finances/${f.clinic.id}/takings?date=2026-10-17`, headers: authHeader(f.admin.token) })).json().takings;
    expect(t.total).toBe(17000);
    expect(t.payments.find((p: any) => p.id === momo.id)).toMatchObject({ voidReason: 'Reversed by the network' });
  });

  it("sums up a month: money in by method and day, what was billed, money out, what is left - and what is still owed", async () => {
    const f = await takingsDay();
    const expense = (payload: object) => app.inject({ method: 'POST', url: '/expenses', headers: authHeader(f.admin.token), payload });
    expect((await expense({ category: 'MEDICINES_SUPPLIES', description: 'Restock', amount: '150,000', spentOn: '2026-10-05', method: 'BANK', paidTo: 'Joint Medical Store', reference: 'TRF 1' })).statusCode).toBe(200);
    expect((await expense({ category: 'UTILITIES', description: 'Power', amount: 40000, spentOn: '2026-10-17', method: 'MOBILE_MONEY' })).statusCode).toBe(200);
    expect((await expense({ category: 'RENT', description: 'September rent', amount: 300000, spentOn: '2026-09-30' })).statusCode).toBe(200);

    const s = (await app.inject({ method: 'GET', url: `/finances/${f.clinic.id}/summary?month=2026-10`, headers: authHeader(f.admin.token) })).json().summary;
    expect(s).toMatchObject({ month: '2026-10', income: 28000, payments: 4, expenses: 190000, net: 28000 - 190000, previousIncome: 0 });
    expect(s.byMethod.find((m: any) => m.method === 'CASH').total).toBe(20000);
    expect(s.byDay).toHaveLength(31);
    expect(s.byDay.find((d: any) => d.date === '2026-10-17').total).toBe(25000);
    expect(s.byDay.find((d: any) => d.date === '2026-10-18').total).toBe(3000);
    expect(s.expensesByCategory.map((e: any) => [e.category, e.total])).toEqual([['MEDICINES_SUPPLIES', 150000], ['UTILITIES', 40000]]);
    expect(s.billed.map((b: any) => b.kind).sort()).toEqual(['CONSULTATION', 'MEDICINE', 'OTHER']);
    expect(s.outstanding).toBe(0);

    const september = (await app.inject({ method: 'GET', url: `/finances/${f.clinic.id}/summary?month=2026-09`, headers: authHeader(f.admin.token) })).json().summary;
    expect(september).toMatchObject({ income: 0, expenses: 300000 });
    expect((await app.inject({ method: 'GET', url: `/finances/${f.clinic.id}/summary`, headers: authHeader(f.desk.token) })).statusCode).toBe(403);
  });

  it('exports the month as a spreadsheet of money in and money out', async () => {
    const f = await takingsDay();
    await app.inject({ method: 'POST', url: '/expenses', headers: authHeader(f.admin.token), payload: { category: 'TRANSPORT', description: 'Boda, "urgent"', amount: 5000, spentOn: '2026-10-17', method: 'CASH' } });
    const res = await app.inject({ method: 'GET', url: `/finances/${f.clinic.id}/export?month=2026-10`, headers: authHeader(f.admin.token) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('finances-2026-10.csv');
    expect(res.body).toContain('Money in,2026-10-17,Receipt 000001,Achieng Mary,,Cash,12000,Sarah Nakato,');
    expect(res.body).toContain('Money out,2026-10-17,,,"Transport - Boda, ""urgent""",Cash,-5000,Grace Nankya,');
  });

  it('records expenses for administrators only, checks them, and voids rather than deletes', async () => {
    const f = await facility();
    const expense = (token: string, payload: object) => app.inject({ method: 'POST', url: '/expenses', headers: authHeader(token), payload });
    expect((await expense(f.desk.token, { category: 'RENT', description: 'Rent', amount: 1000 })).statusCode).toBe(403);
    expect((await expense(f.admin.token, { category: 'PARTY', description: 'x', amount: 1000 })).json().error).toBe('Choose what the money was spent on');
    expect((await expense(f.admin.token, { category: 'RENT', description: ' ', amount: 1000 })).json().error).toBe('Describe the expense');
    expect((await expense(f.admin.token, { category: 'RENT', description: 'Rent', amount: -5 })).statusCode).toBe(400);
    expect((await expense(f.admin.token, { category: 'RENT', description: 'Rent', amount: 1000, method: 'INSURANCE' })).statusCode).toBe(400);
    expect((await expense(f.admin.token, { category: 'RENT', description: 'Rent', amount: 1000, spentOn: '2999-01-01' })).json().error).toBe("The date can't be in the future");
    expect((await expense(f.admin.token, { category: 'RENT', description: 'Rent', amount: 1000, spentOn: '18/10/2026' })).statusCode).toBe(400);

    const made = (await expense(f.admin.token, { category: 'RENT', description: 'Rent', amount: 1000 })).json().expense;
    expect(made.clinicId).toBe(f.clinic.id);
    const voided = await app.inject({ method: 'POST', url: `/expenses/${made.id}/void`, headers: authHeader(f.admin.token), payload: { reason: 'Entered twice' } });
    expect(voided.json().expense.voidReason).toBe('Entered twice');
    const listed = (await app.inject({ method: 'GET', url: `/expenses/${f.clinic.id}`, headers: authHeader(f.admin.token) })).json().expenses;
    expect(listed).toHaveLength(1);
    const summary = (await app.inject({ method: 'GET', url: `/finances/${f.clinic.id}/summary`, headers: authHeader(f.admin.token) })).json().summary;
    expect(summary.expenses).toBe(0);
    const other = await facility('Elsewhere');
    expect((await app.inject({ method: 'POST', url: `/expenses/${made.id}/void`, headers: authHeader(other.admin.token), payload: { reason: 'Not mine' } })).statusCode).toBe(403);
  });

  it('counts money received, not bills raised, as revenue on the dashboard and in the monthly report', async () => {
    const f = await facility();
    await pay(f.desk.token, f.invoice.id, { amount: 7000, method: 'CASH' });
    const dashboard = (await app.inject({ method: 'GET', url: `/dashboard/${f.clinic.id}`, headers: authHeader(f.admin.token) })).json();
    expect(dashboard.stats.totalRevenue).toBe(7000);
  });

  it('shows the patient what is still owed in the Patient Portal', async () => {
    const f = await facility();
    await pay(f.desk.token, f.invoice.id, { amount: 7000, method: 'CASH' });
    const account = await prisma.patientAccount.create({
      data: { portableId: 'BLM-P-TEST01', email: 'portal@example.org', phone: '0700000001', phoneKey: '700000001', password: 'x', createdByClinicId: f.clinic.id, createdByUserId: f.admin.user.id },
    });
    await prisma.patient.update({ where: { id: f.patient.id }, data: { patientAccountId: account.id } });
    const token = app.jwt.sign({ kind: 'patient', patientAccountId: account.id });
    const me = await app.inject({ method: 'GET', url: '/patient-portal/me', headers: authHeader(token) });
    expect(JSON.stringify(me.json())).toContain('"amountPaid":7000');
  });
});

describe('demo facilities show the money side too', () => {
  it('has itemised bills, a part payment, today\'s takings and the month\'s expenses', async () => {
    const hq = await seedClinic({ name: 'Bulamu HQ' });
    const { user, password } = await seedUser({ clinicId: hq.id, role: 'SUPER_ADMIN' });
    const operator = (await loginAs(app, user.email, password)).token;
    const demo = (await app.inject({ method: 'POST', url: '/super-admin/system/demo-facility', headers: authHeader(operator), payload: { email: 'prospect@example.org' } })).json();
    const admin = demo.accounts.find((a: any) => a.role === 'ADMIN');
    const { token, user: demoAdmin } = await loginAs(app, admin.email, demo.password);

    const bills = (await app.inject({ method: 'GET', url: `/invoices/${demoAdmin.clinicId}`, headers: authHeader(token) })).json().invoices;
    expect(bills).toHaveLength(6);
    expect(bills.some((b: any) => b.state === 'Part paid')).toBe(true);
    expect(bills.some((b: any) => !b.consultationId)).toBe(true);
    expect(bills.flatMap((b: any) => b.items).some((i: any) => i.kind === 'MEDICINE')).toBe(true);
    for (const bill of bills) expect(bill.amountPaid).toBeLessThanOrEqual(bill.amount);

    const today = (await app.inject({ method: 'GET', url: `/finances/${demoAdmin.clinicId}/takings`, headers: authHeader(token) })).json().takings;
    expect(today.total).toBe(11000);
    const receipts = await prisma.patientPayment.findMany({ where: { clinicId: demoAdmin.clinicId }, orderBy: { receiptNumber: 'asc' } });
    expect(receipts.map((r) => r.receiptNumber)).toEqual(receipts.map((_, i) => i + 1));
    expect((await prisma.clinic.findUniqueOrThrow({ where: { id: demoAdmin.clinicId } })).lastReceiptNumber).toBe(receipts.length);
    expect(await prisma.expense.count({ where: { clinicId: demoAdmin.clinicId } })).toBe(3);

    // The visitor can take the next payment straight away.
    const open = bills.find((b: any) => b.state === 'Unpaid');
    const desk = demo.accounts.find((a: any) => a.role === 'STAFF');
    const deskToken = (await loginAs(app, desk.email, demo.password)).token;
    const paid = await pay(deskToken, open.id, { amount: 1000, method: 'CASH' });
    expect(paid.statusCode).toBe(200);
    expect(paid.json().payment.receiptNumber).toBe(String(receipts.length + 1).padStart(6, '0'));
  });
});

describe("the patient's own bills in the Patient Portal", () => {
  /** A Patient Portal sign-in for the facility's patient, the way a facility sets one up. */
  async function portalSignIn(f: Awaited<ReturnType<typeof facility>>, phone = '0700 000 001', email = 'achieng@example.org') {
    const created = await app.inject({ method: 'POST', url: `/patients/${f.patient.id}/portal-account`, headers: authHeader(f.desk.token), payload: { phone, email } });
    expect(created.statusCode).toBe(200);
    const token = new URL(created.json().devSetPasswordUrl).searchParams.get('token')!;
    await app.inject({ method: 'POST', url: '/patient-auth/set-password', payload: { token, password: 'MyNewPassword123!', phone } });
    const login = await app.inject({ method: 'POST', url: '/patient-auth/login', payload: { identifier: created.json().portableId, password: 'MyNewPassword123!' } });
    return login.json().token as string;
  }

  it('shows every bill line by line with its receipts - visits and walk-ins - and lets the patient download their own receipts only', async () => {
    const f = await facility();
    const kept = (await pay(f.desk.token, f.invoice.id, { amount: 10000, method: 'CASH' })).json().payment;
    const mistaken = (await pay(f.desk.token, f.invoice.id, { amount: 5000, method: 'MOBILE_MONEY', reference: 'MP123' })).json().payment;
    expect((await app.inject({ method: 'POST', url: `/payments/${mistaken.id}/void`, headers: authHeader(f.admin.token), payload: { reason: 'Entered twice' } })).statusCode).toBe(200);
    const walkIn = await app.inject({ method: 'POST', url: '/invoices', headers: authHeader(f.desk.token), payload: { patientId: f.patient.id, items: [{ kind: 'OTHER', description: 'Dressing', unitPrice: 3000 }] } });
    const cancelled = await app.inject({ method: 'POST', url: '/invoices', headers: authHeader(f.desk.token), payload: { patientId: f.patient.id, items: [{ kind: 'OTHER', description: 'Opened by mistake', unitPrice: 500 }] } });
    expect((await app.inject({ method: 'PATCH', url: `/invoices/${cancelled.json().invoice.id}/cancel`, headers: authHeader(f.admin.token) })).statusCode).toBe(200);

    const token = await portalSignIn(f);
    const me = (await app.inject({ method: 'GET', url: '/patient-portal/me', headers: authHeader(token) })).json();
    const bills = me.records[0].invoices;
    expect(bills.map((b: any) => b.id).sort()).toEqual([f.invoice.id, walkIn.json().invoice.id].sort()); // not the cancelled one
    const visitBill = bills.find((b: any) => b.id === f.invoice.id);
    expect(visitBill).toMatchObject({ amount: 20000, amountPaid: 10000, balance: 10000, consultationId: f.consultation.id });
    expect(visitBill.items).toEqual([expect.objectContaining({ kind: 'CONSULTATION', kindLabel: 'Consultation', amount: 20000 })]);
    // The voided payment is not one the patient made.
    expect(visitBill.payments).toEqual([expect.objectContaining({ id: kept.id, receiptNumber: kept.receiptNumber, amount: 10000, method: 'Cash' })]);
    expect(bills.find((b: any) => b.id === walkIn.json().invoice.id)).toMatchObject({ consultationId: null, balance: 3000 });

    const receipt = await app.inject({ method: 'GET', url: `/patient-portal/payments/${kept.id}/receipt/pdf`, headers: authHeader(token) });
    expect(receipt.statusCode).toBe(200);
    expect(receipt.headers['content-type']).toContain('application/pdf');
    const text = pdfText(receipt.rawPayload);
    expect(text).toContain(kept.receiptNumber);
    expect(text).toContain('Achieng Mary');
    expect(text).toContain('downloaded by the patient');
    expect((await app.inject({ method: 'GET', url: `/patient-portal/payments/${mistaken.id}/receipt/pdf`, headers: authHeader(token) })).statusCode).toBe(404);

    // Someone else's receipt, at another facility: not found, as if it did not exist.
    const other = await facility('Other Clinic');
    const theirs = (await pay(other.desk.token, other.invoice.id, { amount: 1000, method: 'CASH' })).json().payment;
    expect((await app.inject({ method: 'GET', url: `/patient-portal/payments/${theirs.id}/receipt/pdf`, headers: authHeader(token) })).statusCode).toBe(404);
    // ...and staff tokens are not patient tokens.
    expect((await app.inject({ method: 'GET', url: `/patient-portal/payments/${kept.id}/receipt/pdf`, headers: authHeader(f.desk.token) })).statusCode).toBe(401);
  });
});
