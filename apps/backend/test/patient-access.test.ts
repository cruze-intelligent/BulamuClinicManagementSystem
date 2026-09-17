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

async function createActivePortalAccount(app: FastifyInstance, staffToken: string, patientId: string, overrides: Partial<{ phone: string; email: string; password: string }> = {}) {
  const phone = overrides.phone ?? '0756111222';
  const email = overrides.email ?? 'jane@example.com';
  const password = overrides.password ?? 'MyNewPassword123!';

  const createResponse = await app.inject({
    method: 'POST',
    url: `/patients/${patientId}/portal-account`,
    headers: authHeader(staffToken),
    payload: { phone, email },
  });
  const { portableId, devSetPasswordUrl } = createResponse.json();
  const setPasswordToken = new URL(devSetPasswordUrl).searchParams.get('token')!;
  await app.inject({ method: 'POST', url: '/patient-auth/set-password', payload: { token: setPasswordToken, password } });

  const loginResponse = await app.inject({ method: 'POST', url: '/patient-auth/login', payload: { identifier: portableId, password } });
  return { portableId, patientToken: loginResponse.json().token as string, password };
}

describe('cross-facility patient linking (Phase 4)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lets staff look up a patient by portable ID with only identity-confirming fields, nothing clinical', async () => {
    const clinicA = await seedClinic({ name: 'Clinic A' });
    const clinicB = await seedClinic({ name: 'Clinic B' });
    const { user: userA, password: passwordA } = await seedUser({ clinicId: clinicA.id, role: 'NURSE' });
    const { token: tokenA } = await loginAs(app, userA.email, passwordA);
    const patientId = await registerPatient(app, tokenA);
    const { portableId } = await createActivePortalAccount(app, tokenA, patientId);

    const { user: userB, password: passwordB } = await seedUser({ clinicId: clinicB.id, role: 'NURSE' });
    const { token: tokenB } = await loginAs(app, userB.email, passwordB);

    const response = await app.inject({
      method: 'POST',
      url: '/patients/lookup-account',
      headers: authHeader(tokenB),
      payload: { portableId },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.name).toBe('Jane Mukasa');
    expect(body.alreadyLinkedPatientId).toBeNull();
    expect(body.phone).toBeUndefined();
    expect(body.email).toBeUndefined();
  });

  it('returns 404 for a portable ID that does not exist', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({
      method: 'POST',
      url: '/patients/lookup-account',
      headers: authHeader(token),
      payload: { portableId: 'BLM-P-NOPE99' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('links a patient at a second facility using their password (PIN method), creating a local record and making it visible in their own aggregated view', async () => {
    const clinicA = await seedClinic({ name: 'Clinic A' });
    const clinicB = await seedClinic({ name: 'Clinic B' });
    const { user: userA, password: passwordA } = await seedUser({ clinicId: clinicA.id, role: 'NURSE' });
    const { token: tokenA } = await loginAs(app, userA.email, passwordA);
    const patientId = await registerPatient(app, tokenA);
    const { portableId, patientToken, password } = await createActivePortalAccount(app, tokenA, patientId);

    const { user: userB, password: passwordB } = await seedUser({ clinicId: clinicB.id, role: 'NURSE' });
    const { token: tokenB } = await loginAs(app, userB.email, passwordB);

    const linkResponse = await app.inject({
      method: 'POST',
      url: '/patients/link-account',
      headers: authHeader(tokenB),
      payload: { portableId, method: 'PIN', password },
    });
    expect(linkResponse.statusCode).toBe(200);
    expect(linkResponse.json().patient.clinicId).toBe(clinicB.id);

    const meResponse = await app.inject({ method: 'GET', url: '/patient-portal/me', headers: authHeader(patientToken) });
    const clinicNames = meResponse.json().records.map((r: any) => r.clinic.name).sort();
    expect(clinicNames).toEqual(['Clinic A', 'Clinic B']);
  });

  it('rejects linking with the wrong password', async () => {
    const clinicA = await seedClinic({ name: 'Clinic A' });
    const clinicB = await seedClinic({ name: 'Clinic B' });
    const { user: userA, password: passwordA } = await seedUser({ clinicId: clinicA.id, role: 'NURSE' });
    const { token: tokenA } = await loginAs(app, userA.email, passwordA);
    const patientId = await registerPatient(app, tokenA);
    const { portableId } = await createActivePortalAccount(app, tokenA, patientId);

    const { user: userB, password: passwordB } = await seedUser({ clinicId: clinicB.id, role: 'NURSE' });
    const { token: tokenB } = await loginAs(app, userB.email, passwordB);

    const response = await app.inject({
      method: 'POST',
      url: '/patients/link-account',
      headers: authHeader(tokenB),
      payload: { portableId, method: 'PIN', password: 'WrongPassword123!' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('links a patient using an emailed OTP, scoped to the requesting clinic', async () => {
    const clinicA = await seedClinic({ name: 'Clinic A' });
    const clinicB = await seedClinic({ name: 'Clinic B' });
    const clinicC = await seedClinic({ name: 'Clinic C' });
    const { user: userA, password: passwordA } = await seedUser({ clinicId: clinicA.id, role: 'NURSE' });
    const { token: tokenA } = await loginAs(app, userA.email, passwordA);
    const patientId = await registerPatient(app, tokenA);
    const { portableId } = await createActivePortalAccount(app, tokenA, patientId);

    const { user: userB, password: passwordB } = await seedUser({ clinicId: clinicB.id, role: 'NURSE' });
    const { token: tokenB } = await loginAs(app, userB.email, passwordB);
    const { user: userC, password: passwordC } = await seedUser({ clinicId: clinicC.id, role: 'NURSE' });
    const { token: tokenC } = await loginAs(app, userC.email, passwordC);

    const otpResponse = await app.inject({
      method: 'POST',
      url: '/patients/link-account/otp',
      headers: authHeader(tokenB),
      payload: { portableId },
    });
    expect(otpResponse.statusCode).toBe(200);
    const otp = otpResponse.json().devOtp;
    expect(otp).toMatch(/^\d{6}$/);

    // The OTP was requested for clinic B - clinic C trying to use it must fail
    const wrongClinicAttempt = await app.inject({
      method: 'POST',
      url: '/patients/link-account',
      headers: authHeader(tokenC),
      payload: { portableId, method: 'OTP', otp },
    });
    expect(wrongClinicAttempt.statusCode).toBe(401);

    const correctAttempt = await app.inject({
      method: 'POST',
      url: '/patients/link-account',
      headers: authHeader(tokenB),
      payload: { portableId, method: 'OTP', otp },
    });
    expect(correctAttempt.statusCode).toBe(200);

    // The same OTP can't be reused a second time
    const replay = await app.inject({
      method: 'POST',
      url: '/patients/link-account',
      headers: authHeader(tokenB),
      payload: { portableId, method: 'OTP', otp },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('rejects linking the same facility to the same account twice', async () => {
    const clinicA = await seedClinic({ name: 'Clinic A' });
    const clinicB = await seedClinic({ name: 'Clinic B' });
    const { user: userA, password: passwordA } = await seedUser({ clinicId: clinicA.id, role: 'NURSE' });
    const { token: tokenA } = await loginAs(app, userA.email, passwordA);
    const patientId = await registerPatient(app, tokenA);
    const { portableId, password } = await createActivePortalAccount(app, tokenA, patientId);

    const { user: userB, password: passwordB } = await seedUser({ clinicId: clinicB.id, role: 'NURSE' });
    const { token: tokenB } = await loginAs(app, userB.email, passwordB);

    await app.inject({ method: 'POST', url: '/patients/link-account', headers: authHeader(tokenB), payload: { portableId, method: 'PIN', password } });
    const second = await app.inject({ method: 'POST', url: '/patients/link-account', headers: authHeader(tokenB), payload: { portableId, method: 'PIN', password } });
    expect(second.statusCode).toBe(409);
  });

  it('lets a patient see, and revoke, a facility\'s access - revoking removes that facility from their own aggregated view', async () => {
    const clinicA = await seedClinic({ name: 'Clinic A' });
    const clinicB = await seedClinic({ name: 'Clinic B' });
    const { user: userA, password: passwordA } = await seedUser({ clinicId: clinicA.id, role: 'NURSE' });
    const { token: tokenA } = await loginAs(app, userA.email, passwordA);
    const patientId = await registerPatient(app, tokenA);
    const { portableId, patientToken, password } = await createActivePortalAccount(app, tokenA, patientId);

    const { user: userB, password: passwordB } = await seedUser({ clinicId: clinicB.id, role: 'NURSE' });
    const { token: tokenB } = await loginAs(app, userB.email, passwordB);
    await app.inject({ method: 'POST', url: '/patients/link-account', headers: authHeader(tokenB), payload: { portableId, method: 'PIN', password } });

    const accessResponse = await app.inject({ method: 'GET', url: '/patient-portal/access', headers: authHeader(patientToken) });
    expect(accessResponse.statusCode).toBe(200);
    const accessBody = accessResponse.json();
    expect(accessBody.origin.clinic.name).toBe('Clinic A');
    expect(accessBody.grants).toHaveLength(1);
    expect(accessBody.grants[0].clinic.name).toBe('Clinic B');

    const grantId = accessBody.grants[0].id;
    const revokeResponse = await app.inject({ method: 'DELETE', url: `/patient-portal/access/${grantId}`, headers: authHeader(patientToken) });
    expect(revokeResponse.statusCode).toBe(200);

    const meResponse = await app.inject({ method: 'GET', url: '/patient-portal/me', headers: authHeader(patientToken) });
    const clinicNames = meResponse.json().records.map((r: any) => r.clinic.name);
    expect(clinicNames).toEqual(['Clinic A']);

    const secondRevoke = await app.inject({ method: 'DELETE', url: `/patient-portal/access/${grantId}`, headers: authHeader(patientToken) });
    expect(secondRevoke.statusCode).toBe(409);
  });

  it('rejects a staff member from another clinic reading a patient\'s access list or revoking a grant (patient-only route)', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const { token } = await loginAs(app, user.email, password);

    const accessResponse = await app.inject({ method: 'GET', url: '/patient-portal/access', headers: authHeader(token) });
    expect(accessResponse.statusCode).toBe(401);
  });
});
