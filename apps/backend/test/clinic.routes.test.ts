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

  it('issues the free trial as the facility\'s first receipt - listed in payment history and downloadable as a PDF', async () => {
    const hq = await seedClinic({ name: 'HQ' });
    const { user, password } = await seedUser({ clinicId: hq.id, role: 'SUPER_ADMIN' });
    const { token } = await loginAs(app, user.email, password);

    const pending = await registerPendingFacility('Trial Receipt Clinic');
    const approve = await app.inject({ method: 'PATCH', url: `/clinics/${pending.id}/approve`, headers: authHeader(token) });
    expect(approve.statusCode).toBe(200);

    const trialPayments = await prisma.payment.findMany({ where: { clinicId: pending.id } });
    expect(trialPayments).toHaveLength(1);
    expect(trialPayments[0].amount).toBe(0);
    expect(trialPayments[0].status).toBe('COMPLETED');

    const admin = await prisma.user.findFirstOrThrow({ where: { clinicId: pending.id, role: 'ADMIN' } });
    const { token: adminToken } = await loginAs(app, admin.email, 'SuperSecret123!');

    const history = await app.inject({ method: 'GET', url: '/billing/payments', headers: authHeader(adminToken) });
    expect(history.statusCode).toBe(200);
    expect(history.json().payments).toHaveLength(1);
    expect(history.json().payments[0].amount).toBe(0);

    const receipt = await app.inject({
      method: 'GET',
      url: `/billing/receipts/${trialPayments[0].id}/pdf`,
      headers: authHeader(adminToken),
    });
    expect(receipt.statusCode).toBe(200);
    expect(receipt.headers['content-type']).toBe('application/pdf');
    expect(receipt.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
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

describe('facility detail and export', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('gives SUPER_ADMIN the full sign-up detail of any facility, including location fields', async () => {
    const hq = await seedClinic({ name: 'HQ' });
    const { user, password } = await seedUser({ clinicId: hq.id, role: 'SUPER_ADMIN' });
    const { token } = await loginAs(app, user.email, password);

    const clinic = await seedClinic({ name: 'Detail Clinic', address: '12 Clinic Road' });
    await seedUser({ clinicId: clinic.id, role: 'ADMIN', name: 'Facility Admin' });

    const response = await app.inject({ method: 'GET', url: `/clinics/${clinic.id}`, headers: authHeader(token) });
    expect(response.statusCode).toBe(200);
    const { facility } = response.json();
    expect(facility.name).toBe('Detail Clinic');
    expect(facility.address).toBe('12 Clinic Road');
    expect(facility.facilityCode).toBe(clinic.facilityCode);
    expect(facility.admin.name).toBe('Facility Admin');
    expect(facility.subscription.status).toBe('ACTIVE');
    expect(facility.users).toBe(1);
  });

  it('lets an ADMIN view and export their own facility\'s detail, but not another facility\'s', async () => {
    const clinic = await seedClinic({ name: 'Own Facility' });
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
    const { token } = await loginAs(app, user.email, password);

    const own = await app.inject({ method: 'GET', url: `/clinics/${clinic.id}`, headers: authHeader(token) });
    expect(own.statusCode).toBe(200);
    expect(own.json().facility.name).toBe('Own Facility');

    const exportRes = await app.inject({ method: 'GET', url: `/clinics/${clinic.id}/export`, headers: authHeader(token) });
    expect(exportRes.statusCode).toBe(200);
    expect(exportRes.headers['content-type']).toContain('text/csv');
    expect(exportRes.headers['content-disposition']).toContain('attachment');
    expect(exportRes.body).toContain('Own Facility');
    expect(exportRes.body).toContain(clinic.facilityCode);

    const otherClinic = await seedClinic({ name: 'Not Mine' });
    const denied = await app.inject({ method: 'GET', url: `/clinics/${otherClinic.id}`, headers: authHeader(token) });
    expect(denied.statusCode).toBe(403);
    const deniedExport = await app.inject({ method: 'GET', url: `/clinics/${otherClinic.id}/export`, headers: authHeader(token) });
    expect(deniedExport.statusCode).toBe(403);
  });

  it('rejects non-ADMIN/non-SUPER_ADMIN roles from facility detail and export', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const { token } = await loginAs(app, user.email, password);

    const detail = await app.inject({ method: 'GET', url: `/clinics/${clinic.id}`, headers: authHeader(token) });
    expect(detail.statusCode).toBe(403);
    const exportRes = await app.inject({ method: 'GET', url: `/clinics/${clinic.id}/export`, headers: authHeader(token) });
    expect(exportRes.statusCode).toBe(403);
  });

  it('404s for a facility that does not exist', async () => {
    const hq = await seedClinic({ name: 'HQ' });
    const { user, password } = await seedUser({ clinicId: hq.id, role: 'SUPER_ADMIN' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({ method: 'GET', url: '/clinics/does-not-exist', headers: authHeader(token) });
    expect(response.statusCode).toBe(404);
  });
});
