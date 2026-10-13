import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';
import { pdfImageCount, pdfText } from './pdf-text';

const sendMailMock = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/mailer')>();
  return { ...actual, sendMail: sendMailMock };
});

process.env.PESAPAL_CONSUMER_KEY = 'test-consumer-key';
process.env.PESAPAL_CONSUMER_SECRET = 'test-consumer-secret';
process.env.PESAPAL_IPN_ID = 'test-ipn-id';

const DAY = 24 * 60 * 60 * 1000;
const OPERATOR = 'starplay.stargames@gmail.com';

let app: FastifyInstance;

beforeEach(async () => {
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue({ sent: true, via: 'relay' });
  await resetDb();
  app = await buildTestApp();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await app?.close();
});

async function staff(clinicId: string, role: 'ADMIN' | 'DOCTOR' | 'NURSE' | 'STAFF' | 'SUPER_ADMIN', name?: string) {
  const { user, password } = await seedUser({ clinicId, role, ...(name ? { name } : {}) });
  return { user, token: (await loginAs(app, user.email, password)).token };
}

// --- Facility logos -----------------------------------------------------------

describe('facility logos', () => {
  // A real 1x1 PNG.
  const logoDataUrl = async () =>
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  it("lets the facility's administrator add, show and remove its logo - and prints it on its documents", async () => {
    const clinic = await seedClinic({ name: 'Mbarara Family Clinic' });
    const admin = await staff(clinic.id, 'ADMIN', 'Grace Nankya');
    const patient = await prisma.patient.create({ data: { name: 'Achieng Mary', phone: '0700', clinicId: clinic.id } });
    const appointment = await prisma.appointment.create({ data: { patientId: patient.id, doctorId: admin.user.id, clinicId: clinic.id, date: new Date(), time: '09:00' } });
    const consultation = await prisma.consultation.create({ data: { appointmentId: appointment.id, patientId: patient.id, diagnosis: 'Malaria', symptoms: 'Fever' } });
    const invoice = await prisma.invoice.create({ data: { consultationId: consultation.id, clinicId: clinic.id, amount: 20000 } });
    const pdf = async () => (await app.inject({ method: 'GET', url: `/invoices/${invoice.id}/pdf`, headers: authHeader(admin.token) })).rawPayload;

    const before = await pdf();
    const put = await app.inject({ method: 'PUT', url: `/clinics/${clinic.id}/logo`, headers: authHeader(admin.token), payload: { image: await logoDataUrl() } });
    expect(put.statusCode).toBe(200);

    const shown = await app.inject({ method: 'GET', url: `/clinics/${clinic.id}/logo`, headers: authHeader(admin.token) });
    expect(shown.statusCode).toBe(200);
    expect(shown.headers['content-type']).toBe('image/png');

    const after = await pdf();
    expect(pdfImageCount(after)).toBeGreaterThan(pdfImageCount(before));
    expect(pdfText(after)).toContain('by Grace Nankya, Administrator');

    expect((await app.inject({ method: 'DELETE', url: `/clinics/${clinic.id}/logo`, headers: authHeader(admin.token) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/clinics/${clinic.id}/logo`, headers: authHeader(admin.token) })).statusCode).toBe(404);
  });

  it('accepts only PNG or JPEG under 500 KB, from the admin of that facility', async () => {
    const clinic = await seedClinic();
    const admin = await staff(clinic.id, 'ADMIN');
    const nurse = await staff(clinic.id, 'NURSE');
    const other = await seedClinic({ name: 'Other' });
    const outsider = await staff(other.id, 'ADMIN');
    const put = (token: string, image: string, clinicId = clinic.id) =>
      app.inject({ method: 'PUT', url: `/clinics/${clinicId}/logo`, headers: authHeader(token), payload: { image } });

    expect((await put(admin.token, 'data:image/gif;base64,R0lGODlhAQABAAAAACw=')).statusCode).toBe(400);
    expect((await put(admin.token, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64'))).statusCode).toBe(400);
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(600 * 1024)]);
    expect((await put(admin.token, big.toString('base64'))).statusCode).toBe(400);
    // A PNG header on something that isn't really a PNG is refused too.
    expect((await put(admin.token, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64'))).statusCode).toBe(400);

    const png = await logoDataUrl();
    expect((await put(nurse.token, png)).statusCode).toBe(403);
    expect((await put(outsider.token, png)).statusCode).toBe(403);
    expect(await prisma.clinicLogo.count()).toBe(0);
  });
});

// --- Patient invoices (the facility's; Bulamu only keeps the record) ------------

describe("patient invoices - the facility's bills, which Bulamu only records", () => {
  async function setup() {
    const clinic = await seedClinic();
    const doctor = await staff(clinic.id, 'DOCTOR', 'Dr Okello');
    const patient = await prisma.patient.create({ data: { name: 'Achieng Mary', phone: '0700', clinicId: clinic.id } });
    const appointment = await prisma.appointment.create({ data: { patientId: patient.id, doctorId: doctor.user.id, clinicId: clinic.id, date: new Date(), time: '09:00' } });
    return { clinic, doctor, patient, appointment };
  }
  const push = (token: string, clinicId: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/sync/push', headers: authHeader(token), payload: { operations: [{ id: `m-${Math.random()}`, entity: 'consultation', clinicId, payload }] } });

  it('turns a fee recorded with a consultation (even offline) into one invoice, however often the record is re-sent', async () => {
    const { clinic, doctor, patient, appointment } = await setup();
    const consultation = { id: 'c-fee', appointmentId: appointment.id, patientId: patient.id, symptoms: 'Fever', diagnoses: [{ description: 'Malaria' }], fee: 25000 };

    await push(doctor.token, clinic.id, { ...consultation, updatedAt: new Date().toISOString() });
    await push(doctor.token, clinic.id, { ...consultation, fee: 99000, updatedAt: new Date(Date.now() + 1000).toISOString() });

    const invoices = await prisma.invoice.findMany({ where: { consultationId: 'c-fee' } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ amount: 25000, status: 'PENDING', clinicId: clinic.id });
  });

  it('refuses an impossible fee', async () => {
    const { clinic, doctor, patient, appointment } = await setup();
    const res = await push(doctor.token, clinic.id, { id: 'c-bad', appointmentId: appointment.id, patientId: patient.id, symptoms: 'x', diagnoses: [{ description: 'y' }], fee: -5, updatedAt: new Date().toISOString() });
    expect(res.json().applied).toHaveLength(0);
    expect(await prisma.invoice.count()).toBe(0);
    const online = await app.inject({ method: 'POST', url: '/consultations', headers: authHeader(doctor.token), payload: { appointmentId: appointment.id, patientId: patient.id, symptoms: 'x', diagnosis: 'y', fee: 12.5 } });
    expect(online.statusCode).toBe(400);
  });

  it('bills the facility where the visit happened, even when the platform administrator records it', async () => {
    const { clinic, patient, appointment } = await setup();
    const hq = await seedClinic({ name: 'Bulamu HQ' });
    const operator = await staff(hq.id, 'SUPER_ADMIN');
    const res = await app.inject({ method: 'POST', url: '/consultations', headers: authHeader(operator.token), payload: { appointmentId: appointment.id, patientId: patient.id, symptoms: 'x', diagnosis: 'y', amount: 10000 } });
    expect(res.statusCode).toBe(200);
    expect((await prisma.invoice.findFirstOrThrow()).clinicId).toBe(clinic.id);
  });

  it('adds a charge afterwards, is paid once, and can be cancelled while unpaid', async () => {
    const { clinic, doctor, patient, appointment } = await setup();
    const admin = await staff(clinic.id, 'ADMIN');
    const nurse = await staff(clinic.id, 'NURSE');
    const consultation = await prisma.consultation.create({ data: { appointmentId: appointment.id, patientId: patient.id, diagnosis: 'Malaria', symptoms: 'Fever' } });

    expect((await app.inject({ method: 'POST', url: '/invoices', headers: authHeader(nurse.token), payload: { consultationId: consultation.id, amount: 5000 } })).statusCode).toBe(403);
    const created = await app.inject({ method: 'POST', url: '/invoices', headers: authHeader(doctor.token), payload: { consultationId: consultation.id, amount: '15,000' } });
    expect(created.statusCode).toBe(200);
    expect(created.json().invoice.amount).toBe(15000);
    expect((await app.inject({ method: 'POST', url: '/invoices', headers: authHeader(doctor.token), payload: { consultationId: consultation.id, amount: 1000 } })).statusCode).toBe(409);

    const id = created.json().invoice.id;
    expect((await app.inject({ method: 'PATCH', url: `/invoices/${id}/pay`, headers: authHeader(doctor.token) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: `/invoices/${id}/pay`, headers: authHeader(doctor.token) })).statusCode).toBe(409);
    expect((await app.inject({ method: 'PATCH', url: `/invoices/${id}/cancel`, headers: authHeader(admin.token) })).statusCode).toBe(409);

    const second = await prisma.consultation.create({ data: { appointmentId: (await prisma.appointment.create({ data: { patientId: patient.id, doctorId: doctor.user.id, clinicId: clinic.id, date: new Date(), time: '10:00' } })).id, patientId: patient.id, diagnosis: 'Cough', symptoms: 'Cough' } });
    const waived = await prisma.invoice.create({ data: { consultationId: second.id, clinicId: clinic.id, amount: 8000 } });
    expect((await app.inject({ method: 'PATCH', url: `/invoices/${waived.id}/cancel`, headers: authHeader(doctor.token) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: `/invoices/${waived.id}/cancel`, headers: authHeader(admin.token) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: `/invoices/${waived.id}/pay`, headers: authHeader(admin.token) })).statusCode).toBe(409);
  });
});

// --- Subscription payments (Bulamu's own billing, through Pesapal) -------------

describe("subscription payments - Bulamu's own billing", () => {
  async function pendingPayment(trackingId: string, opts: { trialEndsAt?: Date } = {}) {
    const clinic = await seedClinic({ name: 'Gulu Medical Centre' });
    await prisma.subscription.update({ where: { clinicId: clinic.id }, data: { status: 'TRIALING', trialEndsAt: opts.trialEndsAt ?? new Date(Date.now() - DAY) } });
    const admin = await staff(clinic.id, 'ADMIN');
    const subscription = await prisma.subscription.findUniqueOrThrow({ where: { clinicId: clinic.id } });
    const payment = await prisma.payment.create({
      data: { clinicId: clinic.id, subscriptionId: subscription.id, amount: 100000, currency: 'UGX', status: 'PENDING', pesapalOrderTrackingId: trackingId },
    });
    return { clinic, admin, payment };
  }

  function pesapalReports(status: { status_code: number; amount?: number; currency?: string; description?: string }) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true, status: 200,
      json: async () => url.includes('RequestToken')
        ? { token: 'access-token' }
        : { status_code: status.status_code, payment_status_description: status.description ?? 'x', merchant_reference: 'ref', amount: status.amount ?? 100000, currency: status.currency ?? 'UGX' },
    })));
  }

  const confirm = (token: string, orderTrackingId: string) =>
    app.inject({ method: 'POST', url: '/billing/confirm', headers: authHeader(token), payload: { orderTrackingId } });

  it("confirms the admin's own order on return from Pesapal, and records the period it paid for", async () => {
    const { clinic, admin, payment } = await pendingPayment('track-confirm');
    pesapalReports({ status_code: 1 });

    const res = await confirm(admin.token, 'track-confirm');
    expect(res.json().outcome).toBe('activated');
    const paid = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(paid.status).toBe('COMPLETED');
    expect(paid.periodEnd!.getTime() - paid.periodStart!.getTime()).toBe(30 * DAY);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { clinicId: clinic.id } })).status).toBe('ACTIVE');
    // Pesapal's own notification arriving afterwards changes nothing.
    expect((await confirm(admin.token, 'track-confirm')).json().outcome).toBe('already-applied');

    // The receipt shows its own period and the Pesapal reference, issued by Cruze.
    const receipt = await app.inject({ method: 'GET', url: `/billing/receipts/${payment.id}/pdf`, headers: authHeader(admin.token) });
    const text = pdfText(receipt.rawPayload);
    expect(text).toContain('Cruze Intelligent Systems (U) Ltd');
    expect(text).toContain('track-confirm');
    expect(text).toMatch(/\d{1,2} \w+ 2026 to \d{1,2} \w+ 2026/);
  });

  it("can't be used on another facility's order", async () => {
    await pendingPayment('track-theirs');
    const other = await seedClinic({ name: 'Other' });
    const outsider = await staff(other.id, 'ADMIN');
    expect((await confirm(outsider.token, 'track-theirs')).statusCode).toBe(403);
  });

  it('leaves a payment still being processed as pending, rather than failing it', async () => {
    const { admin, payment } = await pendingPayment('track-pending');
    pesapalReports({ status_code: 0 });
    expect((await confirm(admin.token, 'track-pending')).json().outcome).toBe('pending');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PENDING');
  });

  it("never activates on a payment for less than was charged, and tells the operator", async () => {
    const { clinic, admin, payment } = await pendingPayment('track-short');
    pesapalReports({ status_code: 1, amount: 1000 });
    expect((await confirm(admin.token, 'track-short')).json().outcome).toBe('amount-mismatch');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('FAILED');
    expect((await prisma.subscription.findUniqueOrThrow({ where: { clinicId: clinic.id } })).status).toBe('TRIALING');
    await vi.waitFor(() => expect(sendMailMock.mock.calls.some(([m]) => m.to === OPERATOR && /amount did not match/i.test(m.subject))).toBe(true));
  });

  it('marks a payment Pesapal later reverses, and tells the operator', async () => {
    const { admin, payment } = await pendingPayment('track-reversed');
    pesapalReports({ status_code: 1 });
    await confirm(admin.token, 'track-reversed');
    pesapalReports({ status_code: 3, description: 'Reversed' });
    await app.inject({ method: 'GET', url: '/billing/pesapal/ipn?OrderTrackingId=track-reversed&OrderMerchantReference=ref' });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('REVERSED');
    await vi.waitFor(() => expect(sendMailMock.mock.calls.some(([m]) => m.to === OPERATOR && /reversed/i.test(m.subject))).toBe(true));
  });

  it("shows the platform administrator Bulamu's subscription income - not facilities' patient invoices", async () => {
    const { admin } = await pendingPayment('track-income');
    pesapalReports({ status_code: 1 });
    await confirm(admin.token, 'track-income');
    const hq = await seedClinic({ name: 'Bulamu HQ' });
    const operator = await staff(hq.id, 'SUPER_ADMIN');

    const overview = await app.inject({ method: 'GET', url: '/super-admin/overview', headers: authHeader(operator.token) });
    expect(overview.json().overview.revenue).toBe(100000);
  });
});

// --- Sample documents for the operator ---------------------------------------------

describe('sample documents', () => {
  it('emails one of every document to the operator inbox - and only a platform administrator can ask', async () => {
    const clinic = await seedClinic();
    const admin = await staff(clinic.id, 'ADMIN');
    expect((await app.inject({ method: 'POST', url: '/super-admin/system/sample-documents', headers: authHeader(admin.token) })).statusCode).toBe(403);

    const hq = await seedClinic({ name: 'Bulamu HQ' });
    const operator = await staff(hq.id, 'SUPER_ADMIN');
    const res = await app.inject({ method: 'POST', url: '/super-admin/system/sample-documents', headers: authHeader(operator.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().documents).toHaveLength(7);

    const mail = sendMailMock.mock.calls.map(([m]) => m).find((m) => /Sample documents/.test(m.subject));
    expect(mail.to).toBe(OPERATOR);
    expect(mail.attachments).toHaveLength(7);
    for (const attachment of mail.attachments) {
      expect(attachment.contentType).toBe('application/pdf');
      expect(Buffer.from(attachment.content).length).toBeGreaterThan(1000);
      expect(pdfText(attachment.content)).toContain('SAMPLE - NOT A REAL');
    }
  });
});
