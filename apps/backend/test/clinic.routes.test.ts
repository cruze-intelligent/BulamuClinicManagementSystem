import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

describe('clinic (super-admin) routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lets SUPER_ADMIN view the God Mode overview', async () => {
    const hq = await seedClinic({ name: 'HQ' });
    const { user, password } = await seedUser({ clinicId: hq.id, role: 'SUPER_ADMIN' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({ method: 'GET', url: '/super-admin/overview', headers: authHeader(token) });
    expect(response.statusCode).toBe(200);
  });

  it('rejects a non-super-admin from God Mode routes', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({ method: 'GET', url: '/super-admin/overview', headers: authHeader(token) });
    expect(response.statusCode).toBe(403);
  });
});

describe('facility approval workflow', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  async function registerPendingFacility(name: string) {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        facilityName: name, phone: '0700111222', address: 'Kampala',
        adminName: 'Pending Admin', adminEmail: `${name.toLowerCase().replace(/\s+/g, '-')}@example.ug`, adminPassword: 'SuperSecret123!',
      },
    });
    return prisma.clinic.findFirstOrThrow({ where: { name } });
  }

  it('lists pending facilities for SUPER_ADMIN', async () => {
    const hq = await seedClinic({ name: 'HQ' });
    const { user, password } = await seedUser({ clinicId: hq.id, role: 'SUPER_ADMIN' });
    const { token } = await loginAs(app, user.email, password);

    await registerPendingFacility('Pending One');

    const response = await app.inject({ method: 'GET', url: '/super-admin/pending-clinics', headers: authHeader(token) });
    expect(response.statusCode).toBe(200);
    expect(response.json().clinics).toHaveLength(1);
    expect(response.json().clinics[0].name).toBe('Pending One');
  });

  it('approves a pending facility, activates its admin, and starts a trial subscription', async () => {
    const hq = await seedClinic({ name: 'HQ' });
    const { user, password } = await seedUser({ clinicId: hq.id, role: 'SUPER_ADMIN' });
    const { token } = await loginAs(app, user.email, password);

    const pending = await registerPendingFacility('Approve Me');

    const approve = await app.inject({ method: 'PATCH', url: `/clinics/${pending.id}/approve`, headers: authHeader(token) });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().clinic.registrationStatus).toBe('APPROVED');
    expect(approve.json().clinic.isActive).toBe(true);

    const subscription = await prisma.subscription.findUnique({ where: { clinicId: pending.id } });
    expect(subscription?.status).toBe('TRIALING');
    expect(subscription?.trialEndsAt.getTime()).toBeGreaterThan(Date.now());

    const admin = await prisma.user.findFirst({ where: { clinicId: pending.id, role: 'ADMIN' } });
    expect(admin?.isActive).toBe(true);

    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: admin!.email, password: 'SuperSecret123!' } });
    expect(login.statusCode).toBe(200);
  });

  it('rejects a pending facility with a reason and blocks its admin from logging in', async () => {
    const hq = await seedClinic({ name: 'HQ' });
    const { user, password } = await seedUser({ clinicId: hq.id, role: 'SUPER_ADMIN' });
    const { token } = await loginAs(app, user.email, password);

    const pending = await registerPendingFacility('Reject Me');

    const reject = await app.inject({
      method: 'PATCH', url: `/clinics/${pending.id}/reject`, headers: authHeader(token),
      payload: { reason: 'Could not verify facility license' },
    });
    expect(reject.statusCode).toBe(200);
    expect(reject.json().clinic.registrationStatus).toBe('REJECTED');

    const admin = await prisma.user.findFirst({ where: { clinicId: pending.id, role: 'ADMIN' } });
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: admin!.email, password: 'SuperSecret123!' } });
    expect(login.statusCode).toBe(403);
    expect(login.json().reason).toBe('REJECTED');
    expect(login.json().rejectionReason).toBe('Could not verify facility license');
  });

  it('rejects a non-super-admin from approving facilities', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
    const { token } = await loginAs(app, user.email, password);

    const pending = await registerPendingFacility('Blocked From Approving');
    const response = await app.inject({ method: 'PATCH', url: `/clinics/${pending.id}/approve`, headers: authHeader(token) });
    expect(response.statusCode).toBe(403);
  });
});
