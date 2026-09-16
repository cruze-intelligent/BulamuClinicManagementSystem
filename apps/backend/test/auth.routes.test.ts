import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

describe('auth routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('logs in with correct credentials and returns a token', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'STAFF' });

    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: user.email, password } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.token).toBeDefined();
    expect(body.user.password).toBeUndefined();
  });

  it('rejects an incorrect password', async () => {
    const clinic = await seedClinic();
    const { user } = await seedUser({ clinicId: clinic.id, role: 'STAFF' });

    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: user.email, password: 'wrong' } });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a deactivated user even with the correct password', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'STAFF' });
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: user.email, password } });
    expect(response.statusCode).toBe(403);
    expect(response.json().reason).toBe('ACCOUNT_DEACTIVATED');
  });
});

describe('self-service facility registration', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates a pending facility and admin, and never issues a token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        facilityName: 'New Hope Clinic', phone: '0700111222', address: 'Mbale, Uganda',
        adminName: 'Jane Founder', adminEmail: 'jane@newhope.ug', adminPassword: 'SuperSecret123!',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.token).toBeUndefined();

    const clinic = await prisma.clinic.findFirst({ where: { name: 'New Hope Clinic' } });
    expect(clinic?.registrationStatus).toBe('PENDING');
    expect(clinic?.isActive).toBe(false);

    const admin = await prisma.user.findUnique({ where: { email: 'jane@newhope.ug' } });
    expect(admin?.role).toBe('ADMIN');
  });

  it('ignores any role supplied in the payload and always creates an ADMIN', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        facilityName: 'Sneaky Clinic', phone: '0700111222', address: 'Kampala',
        adminName: 'Sneaky User', adminEmail: 'sneaky@example.ug', adminPassword: 'SuperSecret123!',
        role: 'SUPER_ADMIN',
      },
    });

    const admin = await prisma.user.findUnique({ where: { email: 'sneaky@example.ug' } });
    expect(admin?.role).toBe('ADMIN');
  });

  it('rejects a duplicate email', async () => {
    const clinic = await seedClinic();
    const { user } = await seedUser({ clinicId: clinic.id, role: 'ADMIN' });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        facilityName: 'Duplicate Clinic', phone: '0700111222', address: 'Kampala',
        adminName: 'Someone', adminEmail: user.email, adminPassword: 'SuperSecret123!',
      },
    });

    expect(response.statusCode).toBe(409);
  });

  it('rejects a password shorter than the minimum length', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        facilityName: 'Short Password Clinic', phone: '0700111222', address: 'Kampala',
        adminName: 'Someone', adminEmail: 'short@example.ug', adminPassword: 'short',
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('blocks login for a pending facility with a specific reason', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        facilityName: 'Pending Clinic', phone: '0700111222', address: 'Kampala',
        adminName: 'Pending Admin', adminEmail: 'pending@example.ug', adminPassword: 'SuperSecret123!',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'pending@example.ug', password: 'SuperSecret123!' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().reason).toBe('PENDING_APPROVAL');
  });
});

describe('password reset', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('completes the forgot-password -> reset-password flow and the new password works', async () => {
    const clinic = await seedClinic();
    const { user, password: oldPassword } = await seedUser({ clinicId: clinic.id, role: 'STAFF' });

    const forgot = await app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email: user.email } });
    expect(forgot.statusCode).toBe(200);
    const devResetUrl: string = forgot.json().devResetUrl;
    const token = new URL(devResetUrl).searchParams.get('token');

    const reset = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token, password: 'BrandNewPassword1!' },
    });
    expect(reset.statusCode).toBe(200);

    const oldLogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: user.email, password: oldPassword } });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, password: 'BrandNewPassword1!' },
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it('does not reveal whether an email exists', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'nobody@nowhere.ug' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().devResetUrl).toBeUndefined();
  });

  it('rejects reusing a reset token twice', async () => {
    const clinic = await seedClinic();
    const { user } = await seedUser({ clinicId: clinic.id, role: 'STAFF' });

    const forgot = await app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email: user.email } });
    const token = new URL(forgot.json().devResetUrl).searchParams.get('token');

    const first = await app.inject({ method: 'POST', url: '/auth/reset-password', payload: { token, password: 'FirstPassword1!' } });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({ method: 'POST', url: '/auth/reset-password', payload: { token, password: 'SecondPassword1!' } });
    expect(second.statusCode).toBe(400);
  });

  it('rejects an expired reset token', async () => {
    const clinic = await seedClinic();
    const { user } = await seedUser({ clinicId: clinic.id, role: 'STAFF' });

    const forgot = await app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email: user.email } });
    const token = new URL(forgot.json().devResetUrl).searchParams.get('token')!;

    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await app.inject({ method: 'POST', url: '/auth/reset-password', payload: { token, password: 'NewPassword1!' } });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a password shorter than the minimum length', async () => {
    const clinic = await seedClinic();
    const { user } = await seedUser({ clinicId: clinic.id, role: 'STAFF' });
    const forgot = await app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email: user.email } });
    const token = new URL(forgot.json().devResetUrl).searchParams.get('token');

    const response = await app.inject({ method: 'POST', url: '/auth/reset-password', payload: { token, password: 'short' } });
    expect(response.statusCode).toBe(400);
  });
});
