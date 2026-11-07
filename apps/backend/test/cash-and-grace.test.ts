import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';
import { paidPeriodEnd } from '../src/lib/subscription';
import { pdfText } from './pdf-text';

const sendMailMock = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/mailer')>();
  return { ...actual, sendMail: sendMailMock };
});

vi.setConfig({ testTimeout: 60_000 });

const DAY = 24 * 60 * 60 * 1000;
const MONTH = 30 * DAY;
const days = (n: number) => new Date(Date.now() + n * DAY);
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

async function operator() {
  const hq = await seedClinic({ name: 'Bulamu HQ', phone: '0700 999 999' });
  const { user, password } = await seedUser({ clinicId: hq.id, role: 'SUPER_ADMIN', name: 'Edwin Kubo' });
  return { id: user.id, token: (await loginAs(app, user.email, password)).token };
}

type Billing = { status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE'; trialEndsAt?: Date; currentPeriodEnd?: Date | null; lastPaymentAt?: Date | null; graceDays?: number; graceFrom?: Date | null };

/** A facility at UGX 100,000 a month, with its administrator and a doctor signed in. */
async function facility(billing: Billing) {
  const clinic = await seedClinic({ name: 'Gulu Family Clinic', phone: '0772 400 500' });
  await prisma.subscription.update({
    where: { clinicId: clinic.id },
    data: { amount: 100000, currency: 'UGX', trialEndsAt: billing.trialEndsAt ?? days(-60), currentPeriodEnd: null, lastPaymentAt: null, ...billing },
  });
  const admin = await seedUser({ clinicId: clinic.id, role: 'ADMIN', name: 'Grace Nankya', email: 'admin@gulufamily.ug' });
  const doctor = await seedUser({ clinicId: clinic.id, role: 'DOCTOR' });
  return {
    clinic,
    admin: { id: admin.user.id, token: (await loginAs(app, admin.user.email, admin.password)).token },
    doctor: { token: (await loginAs(app, doctor.user.email, doctor.password)).token },
  };
}
type Facility = Awaited<ReturnType<typeof facility>>;

const cash = (token: string, clinicId: string, payload: object) =>
  app.inject({ method: 'POST', url: `/billing/cash/${clinicId}`, headers: authHeader(token), payload });
const grace = (token: string, clinicId: string, payload: object) =>
  app.inject({ method: 'POST', url: `/billing/grace/${clinicId}`, headers: authHeader(token), payload });
const subscriptionOf = (f: Facility) => prisma.subscription.findUniqueOrThrow({ where: { clinicId: f.clinic.id } });
/** Whether the facility's staff can save: a new patient record is a write like any other. */
const canSave = async (f: Facility) =>
  (await app.inject({ method: 'POST', url: '/patients', headers: authHeader(f.doctor.token), payload: { name: `Patient ${Math.random()}`, phone: '0700 000 001', clinicId: f.clinic.id } })).statusCode !== 402;
const near = (actual: Date | string | null | undefined, expected: Date, toleranceMs = 60_000) =>
  expect(Math.abs(new Date(actual!).getTime() - expected.getTime())).toBeLessThan(toleranceMs);

describe('recording a cash payment', () => {
  it('records the cash now, pays the facility through the next month and emails the receipt with the date, time and who paid', async () => {
    const bulamu = await operator();
    const paidUntil = days(10);
    const f = await facility({ status: 'ACTIVE', currentPeriodEnd: paidUntil, lastPaymentAt: days(-20) });

    const res = await cash(bulamu.token, f.clinic.id, { months: 1, amount: 100000, paidBy: '  Grace   Nankya ', reference: 'RB 0042' });
    expect(res.statusCode).toBe(200);
    const { payment, repeated, receiptPath } = res.json();
    expect(repeated).toBe(false);
    expect(payment).toMatchObject({ status: 'COMPLETED', method: 'CASH', amount: 100000, currency: 'UGX', months: 1, paidBy: 'Grace Nankya', reference: 'RB 0042', recordedBy: bulamu.id });
    near(payment.createdAt, new Date());
    // Paying before the month is out adds the new month on top.
    expect(new Date(payment.periodStart).getTime()).toBe(paidUntil.getTime());
    expect(new Date(payment.periodEnd).getTime()).toBe(paidUntil.getTime() + MONTH);

    const subscription = await subscriptionOf(f);
    expect(subscription).toMatchObject({ status: 'ACTIVE', graceDays: 0, graceFrom: null });
    expect(subscription.currentPeriodEnd!.getTime()).toBe(paidUntil.getTime() + MONTH);
    near(subscription.lastPaymentAt, new Date());
    expect(await prisma.auditLog.count({ where: { entity: 'Payment', recordId: payment.id, actorUserId: bulamu.id } })).toBe(1);

    // The facility's administrator gets the receipt; its staff are told in the app.
    await vi.waitFor(() => expect(sendMailMock.mock.calls.some(([m]) => /payment receipt/.test(m.subject))).toBe(true), { timeout: 15_000 });
    const mail = sendMailMock.mock.calls.map(([m]) => m).find((m) => /payment receipt/.test(m.subject));
    expect(mail.to).toBe('admin@gulufamily.ug');
    const receipt = pdfText(mail.attachments[0].content);
    for (const line of ['SUBSCRIPTION RECEIPT', 'Gulu Family Clinic', 'Payment method', 'Cash', 'Paid by', 'Grace Nankya', 'Received by', 'Edwin Kubo, for Bulamu', 'Receipt book number', 'RB 0042', 'UGX 100,000', 'PAID']) {
      expect(receipt, line).toContain(line);
    }
    expect(receipt).toMatch(/Paid on\s*\d{1,2} \w+ \d{4}, \d{2}:\d{2} EAT/);
    await vi.waitFor(async () => expect(await prisma.notification.count({ where: { clinicId: f.clinic.id, type: 'PAYMENT_RECEIVED' } })).toBeGreaterThan(0), { timeout: 15_000 });

    // The same receipt downloads later, for the facility and for Bulamu, and lists with its payments.
    for (const token of [f.admin.token, bulamu.token]) {
      const pdf = await app.inject({ method: 'GET', url: receiptPath, headers: authHeader(token) });
      expect(pdf.statusCode).toBe(200);
      expect(pdfText(pdf.rawPayload)).toContain('Edwin Kubo, for Bulamu');
    }
    const listed = (await app.inject({ method: 'GET', url: '/billing/payments', headers: authHeader(f.admin.token) })).json().payments;
    expect(listed.map((p: any) => p.id)).toContain(payment.id);
  });

  it('opens a lapsed facility again from today, for as many months as were paid', async () => {
    const bulamu = await operator();
    const f = await facility({ status: 'PAST_DUE', currentPeriodEnd: days(-20), lastPaymentAt: days(-50) });
    expect(await canSave(f)).toBe(false);

    const res = await cash(bulamu.token, f.clinic.id, { months: 3, amount: '300,000', paidBy: 'Okello James' });
    expect(res.statusCode).toBe(200);
    near(res.json().payment.periodStart, new Date());
    near(res.json().paidUntil, new Date(Date.now() + 3 * MONTH));
    expect(await canSave(f)).toBe(true);
  });

  it('starts the paid month when a free trial ends', async () => {
    const bulamu = await operator();
    const trialEnds = days(5);
    const f = await facility({ status: 'TRIALING', trialEndsAt: trialEnds });
    const res = await cash(bulamu.token, f.clinic.id, { amount: 100000, paidBy: 'Okello James' });
    expect(res.statusCode).toBe(200);
    expect(new Date(res.json().paidUntil).getTime()).toBe(trialEnds.getTime() + MONTH);
    expect((await subscriptionOf(f)).status).toBe('ACTIVE');
  });

  it('refuses an amount that is not what the months cost, and anything else wrong, recording nothing', async () => {
    const bulamu = await operator();
    const f = await facility({ status: 'ACTIVE', currentPeriodEnd: days(3), lastPaymentAt: days(-27) });
    const refused: Array<[object, RegExp]> = [
      [{ months: 2, amount: 100000, paidBy: 'Okello' }, /2 months at UGX 100,000 a month is UGX 200,000, not UGX 100,000/],
      [{ months: 1, amount: 90000, paidBy: 'Okello' }, /1 month at UGX 100,000 a month is UGX 100,000, not UGX 90,000/],
      [{ months: 0, amount: 100000, paidBy: 'Okello' }, /between 1 and 12 months/],
      [{ months: 13, amount: 1300000, paidBy: 'Okello' }, /between 1 and 12 months/],
      [{ months: 1.5, amount: 150000, paidBy: 'Okello' }, /between 1 and 12 months/],
      [{ months: 1, amount: 'a lot', paidBy: 'Okello' }, /amount of cash received/],
      [{ months: 1, amount: -100000, paidBy: 'Okello' }, /amount of cash received/],
      [{ months: 1, amount: 100000 }, /name of the person who handed over the cash/],
      [{ months: 1, amount: 100000, paidBy: ' ' }, /name of the person who handed over the cash/],
    ];
    for (const [payload, message] of refused) {
      const res = await cash(bulamu.token, f.clinic.id, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json().error).toMatch(message);
    }
    expect(await prisma.payment.count({ where: { method: 'CASH' } })).toBe(0);
    expect((await subscriptionOf(f)).currentPeriodEnd!.getTime()).toBeLessThan(days(4).getTime());
  });

  it('records one payment however many times the same form is sent, even at the same moment', async () => {
    const bulamu = await operator();
    const paidUntil = days(3);
    const f = await facility({ status: 'ACTIVE', currentPeriodEnd: paidUntil, lastPaymentAt: days(-27) });
    const form = { months: 1, amount: 100000, paidBy: 'Okello James', requestKey: 'form-7f3a' };

    const first = await cash(bulamu.token, f.clinic.id, form);
    const again = await cash(bulamu.token, f.clinic.id, form);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ repeated: true, payment: { id: first.json().payment.id } });

    const together = await Promise.all([1, 2, 3].map(() => cash(bulamu.token, f.clinic.id, { ...form, requestKey: 'form-8b1c' })));
    expect(together.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect(new Set(together.map((r) => r.json().payment.id)).size).toBe(1);

    expect(await prisma.payment.count({ where: { method: 'CASH' } })).toBe(2);
    // Two forms, two months - not five.
    expect((await subscriptionOf(f)).currentPeriodEnd!.getTime()).toBe(paidUntil.getTime() + 2 * MONTH);
    await vi.waitFor(() => expect(sendMailMock.mock.calls.filter(([m]) => /payment receipt/.test(m.subject))).toHaveLength(2), { timeout: 15_000 });
  });

  it('is for Bulamu administrators only, and only for real, approved facilities', async () => {
    const bulamu = await operator();
    const f = await facility({ status: 'ACTIVE', currentPeriodEnd: days(3), lastPaymentAt: days(-27) });
    const form = { months: 1, amount: 100000, paidBy: 'Okello James' };
    expect((await cash(f.admin.token, f.clinic.id, form)).statusCode).toBe(403);
    expect((await cash(f.doctor.token, f.clinic.id, form)).statusCode).toBe(403);
    expect((await grace(f.admin.token, f.clinic.id, { days: 3 })).statusCode).toBe(403);

    const pending = await seedClinic({ name: 'Waiting Clinic', phone: '0752 111 000', registrationStatus: 'PENDING' });
    const demo = await seedClinic({ name: 'Demo Clinic', phone: '0752 222 000' });
    await prisma.clinic.update({ where: { id: demo.id }, data: { isDemo: true } });
    for (const id of [pending.id, demo.id, 'no-such-facility']) {
      expect((await cash(bulamu.token, id, form)).statusCode, id).toBe(404);
    }
    expect(await prisma.payment.count({ where: { method: 'CASH' } })).toBe(0);
  });

  it('shows cash in Bulamu\'s finances and payments export', async () => {
    const bulamu = await operator();
    const f = await facility({ status: 'ACTIVE', currentPeriodEnd: days(3), lastPaymentAt: days(-27) });
    await cash(bulamu.token, f.clinic.id, { months: 2, amount: 200000, paidBy: 'Okello James', reference: 'RB 0043' });

    const finances = (await app.inject({ method: 'GET', url: '/super-admin/finances', headers: authHeader(bulamu.token) })).json().finances;
    expect(finances.received.thisMonth.amount).toBe(200000);
    expect(finances.payments[0]).toMatchObject({ method: 'CASH', paidBy: 'Okello James', reference: 'RB 0043', amount: 200000, hasReceipt: true });
    const csv = await app.inject({ method: 'GET', url: '/super-admin/finances/payments.csv', headers: authHeader(bulamu.token) });
    expect(csv.body).toContain('Cash,Okello James,RB 0043');
  });
});

describe('grace days for a paid facility whose subscription ran out', () => {
  it('lets the facility keep working for the days given, up to 7 in all, and tells it', async () => {
    const bulamu = await operator();
    const f = await facility({ status: 'PAST_DUE', currentPeriodEnd: days(-3), lastPaymentAt: days(-33) });
    expect(await canSave(f)).toBe(false);

    const first = await grace(bulamu.token, f.clinic.id, { days: 3 });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ graceDays: 3, remaining: 4, emailed: true });
    near(first.json().graceEndsAt, days(3));
    const subscription = await subscriptionOf(f);
    expect(subscription).toMatchObject({ status: 'ACTIVE', graceDays: 3 });
    near(subscription.graceFrom, new Date());
    expect(await canSave(f)).toBe(true);

    const mail = sendMailMock.mock.calls.map(([m]) => m).find((m) => /of grace to renew/.test(m.subject));
    expect(mail.to).toBe('admin@gulufamily.ug');
    expect(mail.subject).toBe('3 days of grace to renew - Gulu Family Clinic');
    expect(mail.html).toContain('count towards your next payment');
    expect(await prisma.auditLog.count({ where: { entity: 'Subscription', clinicId: f.clinic.id } })).toBe(1);

    // More days go on the end of the grace, never past 7 in all.
    const more = await grace(bulamu.token, f.clinic.id, { days: 4 });
    expect(more.json()).toMatchObject({ graceDays: 7, remaining: 0 });
    near(more.json().graceEndsAt, days(7));
    const full = await grace(bulamu.token, f.clinic.id, { days: 1 });
    expect(full.statusCode).toBe(409);
    expect(full.json().error).toMatch(/already had the full 7 grace days/);
    expect((await grace(bulamu.token, f.clinic.id, { days: 8 })).statusCode).toBe(400);
    expect((await grace(bulamu.token, f.clinic.id, { days: 0 })).statusCode).toBe(400);
  });

  it('never goes past 7 days when asked twice at the same moment', async () => {
    const bulamu = await operator();
    const f = await facility({ status: 'PAST_DUE', currentPeriodEnd: days(-3), lastPaymentAt: days(-33) });
    const results = await Promise.all([grace(bulamu.token, f.clinic.id, { days: 5 }), grace(bulamu.token, f.clinic.id, { days: 5 })]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect((await subscriptionOf(f)).graceDays).toBe(5);
  });

  it('is only for a facility that has paid before and whose paid period has ended', async () => {
    const bulamu = await operator();
    const trial = await facility({ status: 'PAST_DUE', trialEndsAt: days(-2) });
    const neverPaid = await grace(bulamu.token, trial.clinic.id, { days: 3 });
    expect(neverPaid.statusCode).toBe(409);
    expect(neverPaid.json().error).toMatch(/never paid.*Extend its free trial instead/);

    await resetDb();
    const bulamu2 = await operator();
    const paid = await facility({ status: 'ACTIVE', currentPeriodEnd: days(12), lastPaymentAt: days(-18) });
    const stillPaid = await grace(bulamu2.token, paid.clinic.id, { days: 3 });
    expect(stillPaid.statusCode).toBe(409);
    expect(stillPaid.json().error).toMatch(/Gulu Family Clinic is paid until/);
    expect((await subscriptionOf(paid)).graceDays).toBe(0);
  });

  it('counts a period that ended an hour ago as ended, before the overnight check marks it', async () => {
    const bulamu = await operator();
    const f = await facility({ status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() - 60 * 60 * 1000), lastPaymentAt: days(-30) });
    expect((await grace(bulamu.token, f.clinic.id, { days: 2 })).statusCode).toBe(200);
    expect(await subscriptionOf(f)).toMatchObject({ status: 'ACTIVE', graceDays: 2 });
  });

  it('closes saving again when the grace runs out unpaid', async () => {
    const f = await facility({ status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() - 1000), lastPaymentAt: days(-37), graceDays: 7, graceFrom: days(-7) });
    expect(await canSave(f)).toBe(false);
    expect((await subscriptionOf(f)).status).toBe('PAST_DUE');
  });

  it('counts the grace days in the next payment, cash or Pesapal', async () => {
    const bulamu = await operator();
    // Paying during the grace: the month starts when the grace began.
    const graceBegan = days(-4);
    const during = await facility({ status: 'ACTIVE', currentPeriodEnd: days(3), lastPaymentAt: days(-34), graceDays: 7, graceFrom: graceBegan });
    const paid = await cash(bulamu.token, during.clinic.id, { amount: 100000, paidBy: 'Okello James' });
    expect(new Date(paid.json().payment.periodStart).getTime()).toBe(graceBegan.getTime());
    expect(new Date(paid.json().paidUntil).getTime()).toBe(graceBegan.getTime() + MONTH);
    expect(await subscriptionOf(during)).toMatchObject({ status: 'ACTIVE', graceDays: 0, graceFrom: null });

    // The same rule Pesapal payments use. Paying long after the grace ran
    // out: the month starts as many days back as the grace lasted.
    const now = new Date('2026-12-01T09:00:00Z');
    const afterGrace = { status: 'PAST_DUE' as const, trialEndsAt: days(-90), currentPeriodEnd: new Date('2026-10-28T09:00:00Z'), graceDays: 7, graceFrom: new Date('2026-10-21T09:00:00Z') };
    expect(paidPeriodEnd(afterGrace, now).getTime()).toBe(now.getTime() - 7 * DAY + MONTH);
    // Without grace, a lapsed facility's month starts the day it pays.
    expect(paidPeriodEnd({ ...afterGrace, graceDays: 0, graceFrom: null }, now).getTime()).toBe(now.getTime() + MONTH);
  });
});
