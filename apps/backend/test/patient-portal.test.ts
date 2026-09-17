import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

async function registerPatient(app: FastifyInstance, token: string, overrides: Partial<{ name: string; phone: string }> = {}) {
  const response = await app.inject({
    method: 'POST',
    url: '/patients',
    headers: authHeader(token),
    payload: { name: overrides.name ?? 'Jane Mukasa', phone: overrides.phone ?? '0756111222', sex: 'FEMALE' },
  });
  return response.json().patient.id as string;
}

describe('patient portal', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lets staff create a portal account for their own patient, then the patient sets a password and logs in', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const { token } = await loginAs(app, user.email, password);
    const patientId = await registerPatient(app, token);

    const createResponse = await app.inject({
      method: 'POST',
      url: `/patients/${patientId}/portal-account`,
      headers: authHeader(token),
      payload: { phone: '0756111222', email: 'jane@example.com' },
    });
    expect(createResponse.statusCode).toBe(200);
    const { portableId, devSetPasswordUrl } = createResponse.json();
    expect(portableId).toMatch(/^BLM-P-/);

    const setPasswordToken = new URL(devSetPasswordUrl).searchParams.get('token')!;
    const setPasswordResponse = await app.inject({
      method: 'POST',
      url: '/patient-auth/set-password',
      payload: { token: setPasswordToken, password: 'MyNewPassword123!' },
    });
    expect(setPasswordResponse.statusCode).toBe(200);

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/patient-auth/login',
      payload: { identifier: portableId, password: 'MyNewPassword123!' },
    });
    expect(loginResponse.statusCode).toBe(200);
    const loginBody = loginResponse.json();
    expect(loginBody.token).toBeTruthy();
    expect(loginBody.mustResetPassword).toBe(false);
  });

  it('also accepts email or phone as the login identifier', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const { token } = await loginAs(app, user.email, password);
    const patientId = await registerPatient(app, token);

    const createResponse = await app.inject({
      method: 'POST',
      url: `/patients/${patientId}/portal-account`,
      headers: authHeader(token),
      payload: { phone: '0756111222', email: 'jane@example.com' },
    });
    const { devSetPasswordUrl } = createResponse.json();
    const setPasswordToken = new URL(devSetPasswordUrl).searchParams.get('token')!;
    await app.inject({ method: 'POST', url: '/patient-auth/set-password', payload: { token: setPasswordToken, password: 'MyNewPassword123!' } });

    const byEmail = await app.inject({ method: 'POST', url: '/patient-auth/login', payload: { identifier: 'jane@example.com', password: 'MyNewPassword123!' } });
    expect(byEmail.statusCode).toBe(200);

    const byPhone = await app.inject({ method: 'POST', url: '/patient-auth/login', payload: { identifier: '0756111222', password: 'MyNewPassword123!' } });
    expect(byPhone.statusCode).toBe(200);
  });

  it('rejects wrong password on login', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const { token } = await loginAs(app, user.email, password);
    const patientId = await registerPatient(app, token);

    const createResponse = await app.inject({
      method: 'POST',
      url: `/patients/${patientId}/portal-account`,
      headers: authHeader(token),
      payload: { phone: '0756111222', email: 'jane@example.com' },
    });
    const { portableId } = createResponse.json();

    const response = await app.inject({ method: 'POST', url: '/patient-auth/login', payload: { identifier: portableId, password: 'WrongPassword123!' } });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a staff member creating a portal account for another clinic\'s patient (cross-facility isolation)', async () => {
    const clinicA = await seedClinic({ name: 'Clinic A' });
    const clinicB = await seedClinic({ name: 'Clinic B' });
    const { user: userA, password: passwordA } = await seedUser({ clinicId: clinicA.id, role: 'NURSE' });
    const { token: tokenA } = await loginAs(app, userA.email, passwordA);
    const patientAId = await registerPatient(app, tokenA);

    const { user: userB, password: passwordB } = await seedUser({ clinicId: clinicB.id, role: 'NURSE' });
    const { token: tokenB } = await loginAs(app, userB.email, passwordB);

    const response = await app.inject({
      method: 'POST',
      url: `/patients/${patientAId}/portal-account`,
      headers: authHeader(tokenB),
      payload: { phone: '0756111222', email: 'jane@example.com' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects creating a second portal account for a patient that already has one', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const { token } = await loginAs(app, user.email, password);
    const patientId = await registerPatient(app, token);

    await app.inject({
      method: 'POST',
      url: `/patients/${patientId}/portal-account`,
      headers: authHeader(token),
      payload: { phone: '0756111222', email: 'jane@example.com' },
    });

    const secondAttempt = await app.inject({
      method: 'POST',
      url: `/patients/${patientId}/portal-account`,
      headers: authHeader(token),
      payload: { phone: '0756111222', email: 'jane-again@example.com' },
    });
    expect(secondAttempt.statusCode).toBe(409);
  });

  it('rejects creating a portal account for the same phone number twice, even for a different patient', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const { token } = await loginAs(app, user.email, password);
    const patient1Id = await registerPatient(app, token, { name: 'Patient One' });
    const patient2Id = await registerPatient(app, token, { name: 'Patient Two', phone: '0756999888' });

    await app.inject({
      method: 'POST',
      url: `/patients/${patient1Id}/portal-account`,
      headers: authHeader(token),
      payload: { phone: '0756111222', email: 'one@example.com' },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/patients/${patient2Id}/portal-account`,
      headers: authHeader(token),
      payload: { phone: '0756111222', email: 'two@example.com' },
    });
    expect(response.statusCode).toBe(409);
  });

  it('rate-limits repeated patient login attempts', async () => {
    for (let i = 0; i < 8; i++) {
      const response = await app.inject({ method: 'POST', url: '/patient-auth/login', payload: { identifier: 'nobody@example.com', password: 'wrong' } });
      expect(response.statusCode).toBe(401);
    }
    const ninth = await app.inject({ method: 'POST', url: '/patient-auth/login', payload: { identifier: 'nobody@example.com', password: 'wrong' } });
    expect(ninth.statusCode).toBe(429);
  });

  it('immediately blocks a deactivated staff member from a requireRole-gated route, not just after their token expires', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const { token } = await loginAs(app, user.email, password);
    const patientId = await registerPatient(app, token);

    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    const response = await app.inject({
      method: 'POST',
      url: `/patients/${patientId}/portal-account`,
      headers: authHeader(token),
      payload: { phone: '0756111222', email: 'jane@example.com' },
    });
    expect(response.statusCode).toBe(401);
  });
});
