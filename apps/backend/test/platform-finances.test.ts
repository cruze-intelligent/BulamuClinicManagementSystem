import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';
import { buildPlatformFinances, paymentStanding, shiftMonth } from '../src/lib/platform-finances';

let app: FastifyInstance;

beforeEach(async () => {
  await resetDb();
  app = await buildTestApp();
});

afterAll(async () => {
  await app?.close();
});

const DAY = 24 * 60 * 60 * 1000;
// Mid-November, mid-morning in Kampala.
const NOW = new Date('2026-11-15T07:00:00Z');
const days = (n: number) => new Date(NOW.getTime() + n * DAY);

async function token(clinicId: string, role: 'SUPER_ADMIN' | 'ADMIN') {
  const { user, password } = await seedUser({ clinicId, role });
  return (await loginAs(app, user.email, password)).token;
}

/** A subscription payment confirmed by Pesapal at `paidAt` (the receipt date is when it was marked completed). */
async function payment(clinicId: string, amount: number, paidAt: Date, status: 'COMPLETED' | 'PENDING' | 'FAILED' | 'REVERSED' = 'COMPLETED') {
  const subscription = await prisma.subscription.findUniqueOrThrow({ where: { clinicId } });
  const p = await prisma.payment.create({ data: { clinicId, subscriptionId: subscription.id, amount, currency: 'UGX', status, pesapalOrderTrackingId: `PSP-${Math.random().toString(16).slice(2)}` } });
  await prisma.$executeRaw`UPDATE "Payment" SET "createdAt" = ${paidAt}, "updatedAt" = ${paidAt} WHERE id = ${p.id}`;
  return p;
}

/**
 * Four facilities: one paid up and due for renewal in ten days, one overdue on
 * a custom plan, one ending its trial, one whose paid month ran out yesterday
 * (not yet swept to past due) - plus a demo and the operator's own account,
 * which never count.
 */
async function platform() {
  const hq = await seedClinic({ name: 'Bulamu HQ' });
  const operator = await token(hq.id, 'SUPER_ADMIN');

  const paid = await seedClinic({ name: 'Arua Health Centre IV' });
  await prisma.subscription.update({ where: { clinicId: paid.id }, data: { status: 'ACTIVE', amount: 100000, currentPeriodEnd: days(10), lastPaymentAt: new Date('2026-11-02T09:00:00Z') } });
  await payment(paid.id, 0, new Date('2026-08-01T09:00:00Z')); // the free-trial receipt: not income
  await payment(paid.id, 100000, new Date('2026-09-14T09:00:00Z'));
  await payment(paid.id, 100000, new Date('2026-11-02T09:00:00Z'));

  const overdue = await seedClinic({ name: 'Bushenyi Clinic' });
  await prisma.subscription.update({ where: { clinicId: overdue.id }, data: { status: 'PAST_DUE', plan: 'CUSTOM', amount: 150000, currentPeriodEnd: days(-5) } });
  await payment(overdue.id, 150000, new Date('2026-10-10T09:00:00Z'));
  await payment(overdue.id, 150000, new Date('2026-10-20T09:00:00Z'), 'REVERSED');
  await payment(overdue.id, 150000, days(-1), 'PENDING'); // a checkout never finished

  const trial = await seedClinic({ name: 'Chiro Clinic' });
  await prisma.subscription.update({ where: { clinicId: trial.id }, data: { status: 'TRIALING', amount: 100000, trialEndsAt: days(5), currentPeriodEnd: null } });

  const lapsed = await seedClinic({ name: 'Dokolo Clinic' });
  await prisma.subscription.update({ where: { clinicId: lapsed.id }, data: { status: 'ACTIVE', amount: 100000, currentPeriodEnd: days(-1) } });

  const demo = await seedClinic({ name: 'Bulamu Test Facility' });
  await prisma.clinic.update({ where: { id: demo.id }, data: { isDemo: true } });
  await payment(demo.id, 999000, days(-3));

  return { operator, paid, overdue, trial, lapsed, hq };
}

describe("Bulamu's own finances", () => {
  it('counts only money actually received from real facilities, by East Africa month', async () => {
    await platform();
    const f = await buildPlatformFinances(NOW);
    expect(f.months).toEqual({ thisMonth: '2026-11', lastMonth: '2026-10' });
    expect(f.received.thisMonth).toMatchObject({ month: '2026-11', amount: 100000, payments: 1 });
    expect(f.received.lastMonth).toMatchObject({ month: '2026-10', amount: 150000, payments: 1 });
    expect(f.received.thisYear).toEqual({ amount: 350000, payments: 3 });
    expect(f.received.allTime).toEqual({ amount: 350000, payments: 3 });
    expect(f.received.reversed).toEqual({ amount: 150000, payments: 1 });
    expect(f.received.pendingCheckouts).toBe(1);

    expect(f.monthly).toHaveLength(12);
    expect(f.monthly[0].month).toBe('2025-12');
    expect(f.monthly.at(-1)!.month).toBe('2026-11');
    expect(f.monthly.find((m) => m.month === '2026-09')).toEqual({ month: '2026-09', amount: 100000, payments: 1 });
    expect(f.monthly.find((m) => m.month === '2026-08')!.amount).toBe(0); // the trial receipt is not income
  });

  it('shows what is coming in and what is late: renewals due, overdue accounts and trials ending', async () => {
    await platform();
    const f = await buildPlatformFinances(NOW);
    expect(f.monthlyRecurring).toEqual({ amount: 100000, facilities: 1 });
    expect(f.expected.dueSoon.facilities.map((x) => x.name)).toEqual(['Arua Health Centre IV']);
    expect(f.expected.dueSoon.amount).toBe(100000);
    // Ran out yesterday counts as overdue already, before the hourly sweep marks it.
    expect(f.expected.overdue.facilities.map((x) => x.name)).toEqual(['Bushenyi Clinic', 'Dokolo Clinic']);
    expect(f.expected.overdue.amount).toBe(250000);
    expect(f.expected.trialsEnding.facilities.map((x) => x.name)).toEqual(['Chiro Clinic']);

    const names = f.facilities.map((x) => x.name);
    expect(names).toEqual(['Arua Health Centre IV', 'Bushenyi Clinic', 'Chiro Clinic', 'Dokolo Clinic']); // no demo, no HQ
    expect(f.facilities.find((x) => x.name === 'Bushenyi Clinic')).toMatchObject({ plan: 'CUSTOM', standing: 'OVERDUE', totalPaid: 150000, payments: 1 });
    expect(f.facilities.find((x) => x.name === 'Arua Health Centre IV')).toMatchObject({ standing: 'PAID', totalPaid: 200000, payments: 2 });
  });

  it('lists payments newest first - with reversed and unfinished ones, never free-trial receipts or demos', async () => {
    await platform();
    const f = await buildPlatformFinances(NOW);
    expect(f.payments.map((p) => [p.facility.name, p.amount, p.status])).toEqual([
      ['Bushenyi Clinic', 150000, 'PENDING'],
      ['Arua Health Centre IV', 100000, 'COMPLETED'],
      ['Bushenyi Clinic', 150000, 'REVERSED'],
      ['Bushenyi Clinic', 150000, 'COMPLETED'],
      ['Arua Health Centre IV', 100000, 'COMPLETED'],
    ]);
    expect(f.payments[0]).toMatchObject({ paidAt: null, hasReceipt: false });
    expect(f.payments[1].hasReceipt).toBe(true);
  });

  it('decides where a facility stands on money', () => {
    expect(paymentStanding({ status: 'ACTIVE', trialEndsAt: days(-40), currentPeriodEnd: days(3) }, NOW)).toBe('PAID');
    expect(paymentStanding({ status: 'ACTIVE', trialEndsAt: days(-40), currentPeriodEnd: days(-3) }, NOW)).toBe('OVERDUE');
    expect(paymentStanding({ status: 'TRIALING', trialEndsAt: days(3), currentPeriodEnd: null }, NOW)).toBe('TRIAL');
    expect(paymentStanding({ status: 'TRIALING', trialEndsAt: days(-1), currentPeriodEnd: null }, NOW)).toBe('OVERDUE');
    expect(paymentStanding({ status: 'PAST_DUE', trialEndsAt: days(-40), currentPeriodEnd: null }, NOW)).toBe('OVERDUE');
    expect(paymentStanding({ status: 'CANCELLED', trialEndsAt: days(-40), currentPeriodEnd: null }, NOW)).toBe('CANCELLED');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-11', 2)).toBe('2027-01');
  });

  it('is for the platform administrator only, and exports every payment as a spreadsheet', async () => {
    const { operator, paid } = await platform();
    const admin = await token(paid.id, 'ADMIN');
    expect((await app.inject({ method: 'GET', url: '/super-admin/finances', headers: authHeader(admin) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/super-admin/finances/payments.csv', headers: authHeader(admin) })).statusCode).toBe(403);

    const res = await app.inject({ method: 'GET', url: '/super-admin/finances', headers: authHeader(operator) });
    expect(res.statusCode).toBe(200);
    expect(res.json().finances.facilities).toHaveLength(4);

    const csv = await app.inject({ method: 'GET', url: '/super-admin/finances/payments.csv', headers: authHeader(operator) });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-disposition']).toMatch(/bulamu-subscription-payments-\d{4}-\d{2}-\d{2}\.csv/);
    expect(csv.body).toContain('Started,Paid on,Facility,Facility code,Amount,Currency,Status,Period from,Period to,Method,Paid by,Reference,Payment ID');
    expect(csv.body).toContain(',2026-09-14,Arua Health Centre IV,');
    expect(csv.body.match(/\r\n/g)).toHaveLength(6); // the header and five payments
    expect(csv.body).not.toContain('Bulamu Test Facility');
  });
});
