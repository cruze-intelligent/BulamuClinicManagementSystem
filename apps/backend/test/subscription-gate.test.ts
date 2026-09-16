import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

describe('subscription gate', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('blocks writes once the trial has expired but still allows reads', async () => {
    const clinic = await seedClinic();
    await prisma.subscription.update({
      where: { clinicId: clinic.id },
      data: { status: 'TRIALING', trialEndsAt: new Date(Date.now() - 1000) },
    });
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'STAFF' });
    const { token } = await loginAs(app, user.email, password);

    const write = await app.inject({
      method: 'POST', url: '/patients', headers: authHeader(token),
      payload: { name: 'Blocked Patient', phone: '0700000000', clinicId: clinic.id },
    });
    expect(write.statusCode).toBe(402);
    expect(write.json().reason).toBe('SUBSCRIPTION_REQUIRED');

    const read = await app.inject({ method: 'GET', url: `/patients/${clinic.id}`, headers: authHeader(token) });
    expect(read.statusCode).toBe(200);

    const subscription = await prisma.subscription.findUnique({ where: { clinicId: clinic.id } });
    expect(subscription?.status).toBe('PAST_DUE');
  });

  it('allows writes while a trial is still active', async () => {
    const clinic = await seedClinic();
    await prisma.subscription.update({
      where: { clinicId: clinic.id },
      data: { status: 'TRIALING', trialEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    });
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'STAFF' });
    const { token } = await loginAs(app, user.email, password);

    const write = await app.inject({
      method: 'POST', url: '/patients', headers: authHeader(token),
      payload: { name: 'Allowed Patient', phone: '0700000000', clinicId: clinic.id },
    });
    expect(write.statusCode).toBe(200);
  });

  it('never blocks SUPER_ADMIN, regardless of their own clinic subscription state', async () => {
    const hq = await seedClinic({ name: 'HQ' });
    await prisma.subscription.update({
      where: { clinicId: hq.id },
      data: { status: 'TRIALING', trialEndsAt: new Date(Date.now() - 1000) },
    });
    const { user, password } = await seedUser({ clinicId: hq.id, role: 'SUPER_ADMIN' });
    const { token } = await loginAs(app, user.email, password);

    const otherClinic = await seedClinic({ name: 'Other' });
    const response = await app.inject({
      method: 'PATCH', url: `/clinics/${otherClinic.id}/status`, headers: authHeader(token),
      payload: { isActive: false },
    });
    expect(response.statusCode).toBe(200);
  });

  it('never blocks the billing routes themselves, even when past due', async () => {
    const clinic = await seedClinic();
    await prisma.subscription.update({
      where: { clinicId: clinic.id },
      data: { status: 'PAST_DUE', trialEndsAt: new Date(Date.now() - 1000) },
    });
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({ method: 'POST', url: '/billing/subscribe', headers: authHeader(token) });
    expect(response.statusCode).not.toBe(402);
  });
});
