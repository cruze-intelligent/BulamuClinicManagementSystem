import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

const sendMailMock = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/mailer')>();
  return { ...actual, sendMail: sendMailMock };
});

const DAY = 24 * 60 * 60 * 1000;

describe('extending a free trial', () => {
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
    const hq = await seedClinic({ name: 'Bulamu HQ' });
    const { user, password } = await seedUser({ clinicId: hq.id, role: 'SUPER_ADMIN' });
    return (await loginAs(app, user.email, password)).token;
  }

  async function facilityOnTrial(trialEndsAt: Date, status: 'TRIALING' | 'PAST_DUE' | 'ACTIVE' = 'TRIALING', lastPaymentAt: Date | null = null) {
    const clinic = await seedClinic({ name: 'Mbale Clinic' });
    await prisma.subscription.update({ where: { clinicId: clinic.id }, data: { status, trialEndsAt, lastPaymentAt } });
    const { user } = await seedUser({ clinicId: clinic.id, role: 'ADMIN', email: 'owner@mbaleclinic.ug' });
    return { clinic, admin: user };
  }

  const extend = (token: string, clinicId: string, days: unknown) =>
    app.inject({ method: 'POST', url: `/billing/trial/${clinicId}/extend`, headers: authHeader(token), payload: { days } });

  it('adds the days to the trial, tells the facility and records who did it', async () => {
    const token = await operator();
    const ends = new Date(Date.now() + 3 * DAY);
    const { clinic } = await facilityOnTrial(ends);

    const res = await extend(token, clinic.id, 5);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ trialExtendedDays: 5, remaining: 9, emailed: true });
    const subscription = await prisma.subscription.findUniqueOrThrow({ where: { clinicId: clinic.id } });
    expect(subscription.trialEndsAt.getTime()).toBe(ends.getTime() + 5 * DAY);
    expect(subscription.status).toBe('TRIALING');

    const mail = sendMailMock.mock.calls.map(([m]) => m).find((m) => /trial has been extended/.test(m.subject));
    expect(mail.to).toBe('owner@mbaleclinic.ug');
    expect(mail.html).toContain('5 days');
    expect(await prisma.auditLog.count({ where: { entity: 'Subscription', clinicId: clinic.id } })).toBe(1);
  });

  it('never adds more than 14 days in all, however it is asked', async () => {
    const token = await operator();
    const { clinic } = await facilityOnTrial(new Date(Date.now() + DAY));

    expect((await extend(token, clinic.id, 15)).statusCode).toBe(400);
    expect((await extend(token, clinic.id, 0)).statusCode).toBe(400);
    expect((await extend(token, clinic.id, 2.5)).statusCode).toBe(400);
    expect((await extend(token, clinic.id, 10)).statusCode).toBe(200);
    const tooMany = await extend(token, clinic.id, 5);
    expect(tooMany.statusCode).toBe(409);
    expect(tooMany.json().remaining).toBe(4);
    expect((await extend(token, clinic.id, 4)).statusCode).toBe(200);
    expect((await extend(token, clinic.id, 1)).json().error).toMatch(/full 14 days/);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { clinicId: clinic.id } })).trialExtendedDays).toBe(14);
  });

  it('a trial that ran out unpaid opens again from today, so the facility can save records again', async () => {
    const token = await operator();
    const { clinic } = await facilityOnTrial(new Date(Date.now() - 4 * DAY), 'PAST_DUE');
    const before = Date.now();
    expect((await extend(token, clinic.id, 7)).statusCode).toBe(200);
    const subscription = await prisma.subscription.findUniqueOrThrow({ where: { clinicId: clinic.id } });
    expect(subscription.status).toBe('TRIALING');
    expect(subscription.trialEndsAt.getTime()).toBeGreaterThanOrEqual(before + 7 * DAY);
  });

  it('only a free trial can be extended, and only by the platform administrator', async () => {
    const token = await operator();
    const paid = await facilityOnTrial(new Date(), 'ACTIVE', new Date());
    expect((await extend(token, paid.clinic.id, 3)).statusCode).toBe(409);
    const lapsedPaid = await seedClinic();
    await prisma.subscription.update({ where: { clinicId: lapsedPaid.id }, data: { status: 'PAST_DUE', lastPaymentAt: new Date() } });
    expect((await extend(token, lapsedPaid.id, 3)).statusCode).toBe(409);

    const trial = await seedClinic();
    await prisma.subscription.update({ where: { clinicId: trial.id }, data: { status: 'TRIALING', trialEndsAt: new Date(Date.now() + DAY) } });
    const { user, password } = await seedUser({ clinicId: trial.id, role: 'ADMIN' });
    const adminToken = (await loginAs(app, user.email, password)).token;
    expect((await extend(adminToken, trial.id, 3)).statusCode).toBe(403);
  });
});
