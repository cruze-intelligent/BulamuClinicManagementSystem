import { randomUUID } from 'crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

// These tests build several clinics and users (each a password hash), which is slow on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

const sendMailMock = vi.hoisted(() => vi.fn());

vi.mock('../src/lib/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/mailer')>();
  return { ...actual, sendMail: sendMailMock };
});

const PHONE = '0756111222';

function tokenFrom(url: string) {
  return new URL(url).searchParams.get('token')!;
}

describe('patient portal invitation and login', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue({ sent: true });
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  async function staffSession(role: 'NURSE' | 'STAFF' = 'NURSE') {
    const clinic = await seedClinic({ name: 'Kampala Clinic' });
    const { user, password } = await seedUser({ clinicId: clinic.id, role });
    const { token } = await loginAs(app, user.email, password);
    return { clinic, token };
  }

  function register(token: string, extra: Record<string, unknown> = {}) {
    return app.inject({
      method: 'POST',
      url: '/patients',
      headers: authHeader(token),
      payload: { name: 'Jane Mukasa', phone: PHONE, sex: 'FEMALE', ...extra },
    });
  }

  it('invites a newly registered patient by email, and they can then set a password and sign in', async () => {
    const { token } = await staffSession();

    const response = await register(token, { email: 'Jane@Example.com' });
    expect(response.statusCode).toBe(200);
    const { patient, portalInvitation } = response.json();
    expect(portalInvitation.status).toBe('created');
    expect(portalInvitation.portableId).toMatch(/^BLM-P-/);

    // The invitation went to the patient's address, naming their facility and ID
    const invitation = sendMailMock.mock.calls.map(([mail]) => mail).find((mail) => mail.to === 'jane@example.com');
    expect(invitation).toBeTruthy();
    expect(invitation.subject).toBe('Your Bulamu patient account');
    expect(invitation.html).toContain(portalInvitation.portableId);
    expect(invitation.html).toContain('Kampala Clinic');

    const stored = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(stored.email).toBe('jane@example.com');
    expect(stored.patientAccountId).toBeTruthy();

    const setPassword = await app.inject({
      method: 'POST',
      url: '/patient-auth/set-password',
      payload: { token: tokenFrom(portalInvitation.devSetPasswordUrl), password: 'MyNewPassword123!', phone: PHONE },
    });
    expect(setPassword.statusCode).toBe(200);

    const login = await app.inject({
      method: 'POST',
      url: '/patient-auth/login',
      payload: { identifier: 'JANE@example.COM', password: 'MyNewPassword123!' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('sends no invitation when no email is given', async () => {
    const { token } = await staffSession();

    const response = await register(token);
    expect(response.statusCode).toBe(200);
    expect(response.json().portalInvitation).toBeUndefined();
    expect(await prisma.patientAccount.count()).toBe(0);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('still registers the patient when the invitation cannot be created', async () => {
    const { token } = await staffSession();

    await register(token, { email: 'first@example.com' });
    // Same phone number again: a portal account already exists for it
    const duplicate = await register(token, { name: 'Jane Again', email: 'second@example.com' });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().portalInvitation.status).toBe('phone_in_use');

    const invalid = await register(token, { name: 'No Email', phone: '0700999888', email: 'not-an-email' });
    expect(invalid.statusCode).toBe(200);
    expect(invalid.json().portalInvitation.status).toBe('invalid_email');
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: invalid.json().patient.id } })).email).toBeNull();
  });

  it('invites patients registered offline once their record syncs', async () => {
    const { clinic, token } = await staffSession();
    const patientId = randomUUID();

    const response = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: authHeader(token),
      payload: {
        operations: [{
          id: randomUUID(), entity: 'patient', action: 'upsert', clinicId: clinic.id,
          payload: { id: patientId, name: 'Offline Patient', phone: PHONE, email: 'offline@example.com', clinicId: clinic.id },
        }],
      },
    });
    expect(response.statusCode).toBe(200);

    const account = await prisma.patientAccount.findUniqueOrThrow({ where: { email: 'offline@example.com' } });
    expect(account.createdByClinicId).toBe(clinic.id);
    expect(sendMailMock.mock.calls.some(([mail]) => mail.to === 'offline@example.com')).toBe(true);

    // Syncing the same record again must not invite a second time
    sendMailMock.mockClear();
    await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: authHeader(token),
      payload: {
        operations: [{
          id: randomUUID(), entity: 'patient', action: 'upsert', clinicId: clinic.id,
          payload: { id: patientId, name: 'Offline Patient', phone: PHONE, email: 'offline@example.com', clinicId: clinic.id, updatedAt: new Date(Date.now() + 1000).toISOString() },
        }],
      },
    });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('requires the phone number registered with the facility to set a password, without using up the link', async () => {
    const { token } = await staffSession();
    const { portalInvitation } = (await register(token, { email: 'jane@example.com' })).json();
    const linkToken = tokenFrom(portalInvitation.devSetPasswordUrl);

    const missingPhone = await app.inject({ method: 'POST', url: '/patient-auth/set-password', payload: { token: linkToken, password: 'MyNewPassword123!' } });
    expect(missingPhone.statusCode).toBe(400);

    const wrongPhone = await app.inject({ method: 'POST', url: '/patient-auth/set-password', payload: { token: linkToken, password: 'MyNewPassword123!', phone: '0700000000' } });
    expect(wrongPhone.statusCode).toBe(400);

    // Different formatting of the right number is accepted, and the link still works
    const rightPhone = await app.inject({ method: 'POST', url: '/patient-auth/set-password', payload: { token: linkToken, password: 'MyNewPassword123!', phone: '+256 756 111 222' } });
    expect(rightPhone.statusCode).toBe(200);
  });

  it('lets a patient reset a forgotten password by email, without revealing whether an account exists', async () => {
    const { token } = await staffSession();
    const { portalInvitation } = (await register(token, { email: 'jane@example.com' })).json();
    await app.inject({ method: 'POST', url: '/patient-auth/set-password', payload: { token: tokenFrom(portalInvitation.devSetPasswordUrl), password: 'MyNewPassword123!', phone: PHONE } });
    sendMailMock.mockClear();

    const unknown = await app.inject({ method: 'POST', url: '/patient-auth/forgot-password', payload: { identifier: 'nobody@example.com' } });
    expect(unknown.statusCode).toBe(200);
    expect(sendMailMock).not.toHaveBeenCalled();

    const known = await app.inject({ method: 'POST', url: '/patient-auth/forgot-password', payload: { identifier: 'JANE@example.com' } });
    expect(known.statusCode).toBe(200);
    // Identical response either way
    expect(known.json()).toEqual(unknown.json());

    const resetMail = sendMailMock.mock.calls.map(([mail]) => mail).find((mail) => mail.to === 'jane@example.com');
    expect(resetMail.subject).toBe('Reset your Bulamu password');
    const resetToken = new URL(/href="([^"]+)"/.exec(resetMail.html)![1]).searchParams.get('token')!;

    const reset = await app.inject({ method: 'POST', url: '/patient-auth/set-password', payload: { token: resetToken, password: 'BrandNewPassword456!', phone: PHONE } });
    expect(reset.statusCode).toBe(200);
    const login = await app.inject({ method: 'POST', url: '/patient-auth/login', payload: { identifier: 'jane@example.com', password: 'BrandNewPassword456!' } });
    expect(login.statusCode).toBe(200);
  });

  it('lets staff resend the set-up email until the patient activates, then directs them to forgot-password', async () => {
    const { token } = await staffSession();
    const { patient, portalInvitation } = (await register(token, { email: 'jane@example.com' })).json();
    const firstLink = tokenFrom(portalInvitation.devSetPasswordUrl);

    const status = await app.inject({ method: 'GET', url: `/patients/${patient.id}/portal-account`, headers: authHeader(token) });
    expect(status.json().account.activated).toBe(false);

    const resend = await app.inject({ method: 'POST', url: `/patients/${patient.id}/portal-account/resend`, headers: authHeader(token) });
    expect(resend.statusCode).toBe(200);
    const secondLink = tokenFrom(resend.json().devSetPasswordUrl);
    expect(secondLink).not.toBe(firstLink);

    // Only the newest emailed link works
    const oldLink = await app.inject({ method: 'POST', url: '/patient-auth/set-password', payload: { token: firstLink, password: 'MyNewPassword123!', phone: PHONE } });
    expect(oldLink.statusCode).toBe(400);
    const newLink = await app.inject({ method: 'POST', url: '/patient-auth/set-password', payload: { token: secondLink, password: 'MyNewPassword123!', phone: PHONE } });
    expect(newLink.statusCode).toBe(200);

    const afterActivation = await app.inject({ method: 'POST', url: `/patients/${patient.id}/portal-account/resend`, headers: authHeader(token) });
    expect(afterActivation.statusCode).toBe(409);
    const activated = await app.inject({ method: 'GET', url: `/patients/${patient.id}/portal-account`, headers: authHeader(token) });
    expect(activated.json().account.activated).toBe(true);
  });

  it('lets front desk staff create a patient portal account', async () => {
    const { token } = await staffSession('STAFF');
    const patientId = (await register(token)).json().patient.id;

    const response = await app.inject({
      method: 'POST',
      url: `/patients/${patientId}/portal-account`,
      headers: authHeader(token),
      payload: { phone: PHONE, email: 'jane@example.com' },
    });
    expect(response.statusCode).toBe(200);
  });
});
