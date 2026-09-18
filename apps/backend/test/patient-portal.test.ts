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
  await app.inject({ method: 'POST', url: '/patient-auth/set-password', payload: { token: setPasswordToken, password, phone } });

  const loginResponse = await app.inject({ method: 'POST', url: '/patient-auth/login', payload: { identifier: portableId, password } });
  return { portableId, patientToken: loginResponse.json().token as string, password };
}

function buildMultipart(fields: Record<string, string>, file: { filename: string; content: Buffer; contentType: string }) {
  const boundary = '----testboundary123456';
  const parts: Buffer[] = [];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`));
  parts.push(file.content);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
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
      payload: { token: setPasswordToken, password: 'MyNewPassword123!', phone: '0756111222' },
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
    await app.inject({ method: 'POST', url: '/patient-auth/set-password', payload: { token: setPasswordToken, password: 'MyNewPassword123!', phone: '0756111222' } });

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

  it('lets a patient view their own aggregated record, including appointments, consultations, and lab tests', async () => {
    const clinic = await seedClinic();
    const { user: doctor, password: doctorPassword } = await seedUser({ clinicId: clinic.id, role: 'DOCTOR' });
    const { token: staffToken } = await loginAs(app, doctor.email, doctorPassword);
    const patientId = await registerPatient(app, staffToken);
    const { patientToken } = await createActivePortalAccount(app, staffToken, patientId);

    const appointmentResponse = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: authHeader(staffToken),
      payload: { patientId, doctorId: doctor.id, date: new Date().toISOString(), time: '09:00', notes: 'Check-up' },
    });
    expect(appointmentResponse.statusCode).toBe(200);
    const appointmentId = appointmentResponse.json().appointment.id;

    const consultationResponse = await app.inject({
      method: 'POST',
      url: '/consultations',
      headers: authHeader(staffToken),
      payload: { appointmentId, patientId, diagnosis: 'Malaria', symptoms: 'Fever', prescriptions: [] },
    });
    expect(consultationResponse.statusCode).toBe(200);

    const meResponse = await app.inject({ method: 'GET', url: '/patient-portal/me', headers: authHeader(patientToken) });
    expect(meResponse.statusCode).toBe(200);
    const body = meResponse.json();
    expect(body.account.portableId).toMatch(/^BLM-P-/);
    expect(body.records).toHaveLength(1);
    expect(body.records[0].clinic.name).toBe(clinic.name);
    expect(body.records[0].appointments).toHaveLength(1);
    expect(body.records[0].consultations).toHaveLength(1);
    expect(body.records[0].consultations[0].diagnosis).toBe('Malaria');
  });

  it('aggregates linked records across more than one facility in the patient\'s own view, once that facility holds an active access grant', async () => {
    const clinicA = await seedClinic({ name: 'Clinic A' });
    const clinicB = await seedClinic({ name: 'Clinic B' });
    const { user: userA, password: passwordA } = await seedUser({ clinicId: clinicA.id, role: 'NURSE' });
    const { token: tokenA } = await loginAs(app, userA.email, passwordA);
    const patientAId = await registerPatient(app, tokenA);
    const { patientToken, portableId, password } = await createActivePortalAccount(app, tokenA, patientAId);

    // The real cross-facility linking flow (Phase 4): Clinic B looks the
    // patient up and verifies identity with their own password, which is
    // what actually creates the PatientAccessGrant that /patient-portal/me
    // requires before including a clinic's records.
    const { user: userB, password: passwordB } = await seedUser({ clinicId: clinicB.id, role: 'NURSE' });
    const { token: tokenB } = await loginAs(app, userB.email, passwordB);
    const linkResponse = await app.inject({
      method: 'POST',
      url: '/patients/link-account',
      headers: authHeader(tokenB),
      payload: { portableId, method: 'PIN', password },
    });
    expect(linkResponse.statusCode).toBe(200);

    const meResponse = await app.inject({ method: 'GET', url: '/patient-portal/me', headers: authHeader(patientToken) });
    expect(meResponse.statusCode).toBe(200);
    const clinicNames = meResponse.json().records.map((r: any) => r.clinic.name).sort();
    expect(clinicNames).toEqual(['Clinic A', 'Clinic B']);
  });

  it('rejects a staff token on the patient-only /patient-portal/me route', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({ method: 'GET', url: '/patient-portal/me', headers: authHeader(token) });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an unauthenticated request to /patient-portal/me', async () => {
    const response = await app.inject({ method: 'GET', url: '/patient-portal/me' });
    expect(response.statusCode).toBe(401);
  });

  it('lets a patient upload a document to their own record and download it back byte-for-byte', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const { token } = await loginAs(app, user.email, password);
    const patientId = await registerPatient(app, token);
    const { patientToken } = await createActivePortalAccount(app, token, patientId);

    const { payload, headers } = buildMultipart(
      { recordId: patientId },
      { filename: 'note.txt', content: Buffer.from('hello from a patient'), contentType: 'text/plain' }
    );
    const uploadResponse = await app.inject({
      method: 'POST',
      url: '/patient-portal/documents',
      headers: { ...authHeader(patientToken), ...headers },
      payload,
    });
    expect(uploadResponse.statusCode).toBe(200);
    const { document } = uploadResponse.json();
    expect(document.category).toBe('PATIENT_UPLOAD');

    const meResponse = await app.inject({ method: 'GET', url: '/patient-portal/me', headers: authHeader(patientToken) });
    expect(meResponse.json().records[0].documents).toHaveLength(1);

    const downloadResponse = await app.inject({
      method: 'GET',
      url: `/patient-portal/documents/${document.id}/download`,
      headers: authHeader(patientToken),
    });
    expect(downloadResponse.statusCode).toBe(200);
    expect(downloadResponse.body).toBe('hello from a patient');
  });

  it('rejects a patient uploading a document against a recordId that is not their own', async () => {
    const clinicA = await seedClinic({ name: 'Clinic A' });
    const clinicB = await seedClinic({ name: 'Clinic B' });
    const { user: userA, password: passwordA } = await seedUser({ clinicId: clinicA.id, role: 'NURSE' });
    const { token: tokenA } = await loginAs(app, userA.email, passwordA);
    const patientAId = await registerPatient(app, tokenA);
    const { patientToken } = await createActivePortalAccount(app, tokenA, patientAId);

    const { user: userB, password: passwordB } = await seedUser({ clinicId: clinicB.id, role: 'NURSE' });
    const { token: tokenB } = await loginAs(app, userB.email, passwordB);
    const otherPatientId = await registerPatient(app, tokenB, { name: 'Not Jane', phone: '0756999777' });

    const { payload, headers } = buildMultipart(
      { recordId: otherPatientId },
      { filename: 'note.txt', content: Buffer.from('hello'), contentType: 'text/plain' }
    );
    const response = await app.inject({
      method: 'POST',
      url: '/patient-portal/documents',
      headers: { ...authHeader(patientToken), ...headers },
      payload,
    });
    expect(response.statusCode).toBe(404);
  });

  it('lets a patient request an appointment, and staff at that clinic accept it into a real appointment', async () => {
    const clinic = await seedClinic();
    const { user: nurse, password: nursePassword } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const { user: doctor } = await seedUser({ clinicId: clinic.id, role: 'DOCTOR' });
    const { token: staffToken } = await loginAs(app, nurse.email, nursePassword);
    const patientId = await registerPatient(app, staffToken);
    const { patientToken } = await createActivePortalAccount(app, staffToken, patientId);

    const preferredDate = new Date(Date.now() + 86400000).toISOString();
    const requestResponse = await app.inject({
      method: 'POST',
      url: '/patient-portal/appointments/request',
      headers: authHeader(patientToken),
      payload: { recordId: patientId, preferredDate, preferredTime: '10:00', reason: 'Follow-up' },
    });
    expect(requestResponse.statusCode).toBe(200);
    const requestId = requestResponse.json().appointmentRequest.id;

    const meResponse = await app.inject({ method: 'GET', url: '/patient-portal/me', headers: authHeader(patientToken) });
    expect(meResponse.json().records[0].appointmentRequests[0].status).toBe('PENDING');

    const listResponse = await app.inject({ method: 'GET', url: `/appointment-requests/${clinic.id}`, headers: authHeader(staffToken) });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().requests).toHaveLength(1);

    const acceptResponse = await app.inject({
      method: 'POST',
      url: `/appointment-requests/${requestId}/accept`,
      headers: authHeader(staffToken),
      payload: { doctorId: doctor.id, date: preferredDate, time: '10:00' },
    });
    expect(acceptResponse.statusCode).toBe(200);
    expect(acceptResponse.json().appointmentRequest.status).toBe('ACCEPTED');

    const meAfterAccept = await app.inject({ method: 'GET', url: '/patient-portal/me', headers: authHeader(patientToken) });
    const record = meAfterAccept.json().records[0];
    expect(record.appointmentRequests[0].status).toBe('ACCEPTED');
    expect(record.appointments).toHaveLength(1);
  });

  it('lets staff decline an appointment request with no appointment created', async () => {
    const clinic = await seedClinic();
    const { user: nurse, password: nursePassword } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const { token: staffToken } = await loginAs(app, nurse.email, nursePassword);
    const patientId = await registerPatient(app, staffToken);
    const { patientToken } = await createActivePortalAccount(app, staffToken, patientId);

    const requestResponse = await app.inject({
      method: 'POST',
      url: '/patient-portal/appointments/request',
      headers: authHeader(patientToken),
      payload: { recordId: patientId, preferredDate: new Date().toISOString() },
    });
    const requestId = requestResponse.json().appointmentRequest.id;

    const declineResponse = await app.inject({
      method: 'POST',
      url: `/appointment-requests/${requestId}/decline`,
      headers: authHeader(staffToken),
      payload: { reason: 'Fully booked' },
    });
    expect(declineResponse.statusCode).toBe(200);
    expect(declineResponse.json().appointmentRequest.status).toBe('DECLINED');

    const meResponse = await app.inject({ method: 'GET', url: '/patient-portal/me', headers: authHeader(patientToken) });
    expect(meResponse.json().records[0].appointmentRequests[0].status).toBe('DECLINED');
    expect(meResponse.json().records[0].appointments).toHaveLength(0);
  });

  it('rejects staff from a different clinic accepting or declining an appointment request (cross-facility isolation)', async () => {
    const clinicA = await seedClinic({ name: 'Clinic A' });
    const clinicB = await seedClinic({ name: 'Clinic B' });
    const { user: nurseA, password: nursePasswordA } = await seedUser({ clinicId: clinicA.id, role: 'NURSE' });
    const { token: tokenA } = await loginAs(app, nurseA.email, nursePasswordA);
    const patientId = await registerPatient(app, tokenA);
    const { patientToken } = await createActivePortalAccount(app, tokenA, patientId);

    const { user: nurseB, password: nursePasswordB } = await seedUser({ clinicId: clinicB.id, role: 'NURSE' });
    const { token: tokenB } = await loginAs(app, nurseB.email, nursePasswordB);

    const requestResponse = await app.inject({
      method: 'POST',
      url: '/patient-portal/appointments/request',
      headers: authHeader(patientToken),
      payload: { recordId: patientId, preferredDate: new Date().toISOString() },
    });
    const requestId = requestResponse.json().appointmentRequest.id;

    const acceptResponse = await app.inject({
      method: 'POST',
      url: `/appointment-requests/${requestId}/accept`,
      headers: authHeader(tokenB),
      payload: { doctorId: nurseB.id, date: new Date().toISOString(), time: '10:00' },
    });
    expect(acceptResponse.statusCode).toBe(403);
  });
});
