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
const PASSWORD = 'MyNewPassword123!';

function multipart(fields: Record<string, string>, file: { filename: string; content: string }) {
  const boundary = '----closureboundary';
  const body = Object.entries(fields)
    .map(([key, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`)
    .join('')
    + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: text/plain\r\n\r\n${file.content}\r\n--${boundary}--\r\n`;
  return { payload: Buffer.from(body), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('patient portal account closure', () => {
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

  // A patient with an active portal account at Clinic A, linked to Clinic B as well, with
  // clinical history, an appointment request, a staff-uploaded document and one of their own.
  async function establishedPatient() {
    const clinicA = await seedClinic({ name: 'Clinic A' });
    const clinicB = await seedClinic({ name: 'Clinic B' });
    const { user: doctorA, password: doctorPasswordA } = await seedUser({ clinicId: clinicA.id, role: 'DOCTOR' });
    const { token: staffTokenA } = await loginAs(app, doctorA.email, doctorPasswordA);
    const { user: nurseB, password: nursePasswordB } = await seedUser({ clinicId: clinicB.id, role: 'NURSE' });
    const { token: staffTokenB } = await loginAs(app, nurseB.email, nursePasswordB);

    const registered = await app.inject({
      method: 'POST', url: '/patients', headers: authHeader(staffTokenA),
      payload: { name: 'Jane Mukasa', phone: PHONE, email: 'jane@example.com', sex: 'FEMALE' },
    });
    const patientId = registered.json().patient.id as string;
    const linkToken = new URL(registered.json().portalInvitation.devSetPasswordUrl).searchParams.get('token')!;
    await app.inject({ method: 'POST', url: '/patient-auth/set-password', payload: { token: linkToken, password: PASSWORD, phone: PHONE } });
    const login = await app.inject({ method: 'POST', url: '/patient-auth/login', payload: { identifier: 'jane@example.com', password: PASSWORD } });
    const patientToken = login.json().token as string;
    const account = await prisma.patientAccount.findUniqueOrThrow({ where: { email: 'jane@example.com' } });

    // Clinical history at Clinic A that must survive closure
    const appointment = await app.inject({ method: 'POST', url: '/appointments', headers: authHeader(staffTokenA), payload: { patientId, doctorId: doctorA.id, date: new Date().toISOString(), time: '09:00' } });
    await app.inject({ method: 'POST', url: '/consultations', headers: authHeader(staffTokenA), payload: { appointmentId: appointment.json().appointment.id, patientId, diagnosis: 'Malaria', symptoms: 'Fever', prescriptions: [] } });

    // A staff document, and one the patient uploaded themselves
    const staffDoc = multipart({ category: 'LAB_RESULT' }, { filename: 'lab.txt', content: 'staff document' });
    await app.inject({ method: 'POST', url: `/patients/${patientId}/documents`, headers: { ...authHeader(staffTokenA), ...staffDoc.headers }, payload: staffDoc.payload });
    const ownDoc = multipart({ recordId: patientId }, { filename: 'mine.txt', content: 'my own document' });
    await app.inject({ method: 'POST', url: '/patient-portal/documents', headers: { ...authHeader(patientToken), ...ownDoc.headers }, payload: ownDoc.payload });

    // Clinic B is given access; the patient asks for an appointment
    const link = await app.inject({ method: 'POST', url: '/patients/link-account', headers: authHeader(staffTokenB), payload: { portableId: account.portableId, method: 'PIN', password: PASSWORD } });
    const patientBId = link.json().patient.id as string;
    await app.inject({ method: 'POST', url: '/patient-portal/appointments/request', headers: authHeader(patientToken), payload: { recordId: patientId, preferredDate: new Date(Date.now() + 86400000).toISOString() } });

    sendMailMock.mockClear();
    return { clinicA, clinicB, staffTokenA, staffTokenB, patientId, patientBId, patientToken, account };
  }

  const close = (token: string, password: string) =>
    app.inject({ method: 'POST', url: '/patient-portal/account/close', headers: authHeader(token), payload: { password } });

  it('refuses to close the account without the correct password, and changes nothing', async () => {
    const { patientToken, account } = await establishedPatient();

    const missing = await app.inject({ method: 'POST', url: '/patient-portal/account/close', headers: authHeader(patientToken), payload: {} });
    expect(missing.statusCode).toBe(400);
    const wrong = await close(patientToken, 'WrongPassword123!');
    expect(wrong.statusCode).toBe(401);

    const unchanged = await prisma.patientAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(unchanged.status).toBe('ACTIVE');
    expect(unchanged.email).toBe('jane@example.com');
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('is only available to the signed-in patient', async () => {
    const { staffTokenA } = await establishedPatient();
    expect((await close(staffTokenA, PASSWORD)).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/patient-portal/account/close', payload: { password: PASSWORD } })).statusCode).toBe(401);
  });

  it('erases the account\'s personal data, ends all access, and confirms by email', async () => {
    const { patientToken, account, clinicA, clinicB } = await establishedPatient();

    const response = await close(patientToken, PASSWORD);
    expect(response.statusCode).toBe(200);

    // Anonymised tombstone
    const closed = await prisma.patientAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(closed.status).toBe('CLOSED');
    expect(closed.email).toBe(`closed-${account.id}@closed.invalid`);
    expect(closed.phone).toBe('');
    expect(closed.phoneKey).toBe('');
    expect(closed.closedAt).not.toBeNull();
    expect(closed.emailOptOuts).toEqual([]);

    // The existing session and every way of signing in stop working
    expect((await app.inject({ method: 'GET', url: '/patient-portal/me', headers: authHeader(patientToken) })).statusCode).toBe(401);
    for (const identifier of ['jane@example.com', account.portableId, PHONE]) {
      const login = await app.inject({ method: 'POST', url: '/patient-auth/login', payload: { identifier, password: PASSWORD } });
      expect(login.statusCode).toBeGreaterThanOrEqual(401);
    }

    // Grants revoked; codes, links and notifications gone
    expect(await prisma.patientAccessGrant.count({ where: { patientAccountId: account.id, revokedAt: null } })).toBe(0);
    expect(await prisma.notification.count({ where: { patientAccountId: account.id } })).toBe(0);
    expect(await prisma.patientPasswordResetToken.count({ where: { patientAccountId: account.id } })).toBe(0);
    expect(await prisma.patientAccessOtp.count({ where: { patientAccountId: account.id } })).toBe(0);

    // The confirmation went to the old address (and only there)
    const mails = sendMailMock.mock.calls.map(([mail]) => mail);
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe('jane@example.com');
    expect(mails[0].subject).toBe('Your Bulamu Patient Portal account has been closed');

    // One audit entry per facility involved, with no personal content
    const audits = await prisma.auditLog.findMany({ where: { entity: 'PatientAccount', recordId: account.id, action: 'DELETE' } });
    expect(audits.map((a) => a.clinicId).sort()).toEqual([clinicA.id, clinicB.id].sort());
    expect(JSON.stringify(audits)).not.toContain('jane@example.com');
  });

  it('keeps the facilities\' clinical records, unlinked from the account, and deletes only the patient\'s own uploads', async () => {
    const { patientToken, account, patientId, patientBId } = await establishedPatient();
    expect(await prisma.document.count({ where: { patientId } })).toBe(2);

    await close(patientToken, PASSWORD);

    for (const id of [patientId, patientBId]) {
      const patient = await prisma.patient.findUniqueOrThrow({ where: { id } });
      expect(patient.deletedAt).toBeNull();
      expect(patient.patientAccountId).toBeNull();
      expect(patient.email).toBeNull();
    }
    expect(await prisma.consultation.count({ where: { patientId } })).toBe(1);

    const documents = await prisma.document.findMany({ where: { patientId } });
    expect(documents.map((d) => d.fileName)).toEqual(['lab.txt']);
    expect(await prisma.document.count({ where: { uploadedByPatientAccountId: account.id } })).toBe(0);

    // Appointment requests are the facility's scheduling records and stay
    expect(await prisma.appointmentRequest.count({ where: { patientAccountId: account.id } })).toBe(1);
  });

  it('frees the phone number and email so the patient can be registered again', async () => {
    const { patientToken, staffTokenA, patientId } = await establishedPatient();
    await close(patientToken, PASSWORD);

    const again = await app.inject({
      method: 'POST', url: `/patients/${patientId}/portal-account`, headers: authHeader(staffTokenA),
      payload: { phone: PHONE, email: 'jane@example.com' },
    });
    expect(again.statusCode).toBe(200);

    // And a closed account cannot be used to reset a password
    sendMailMock.mockClear();
    const closedAccount = await prisma.patientAccount.findFirstOrThrow({ where: { status: 'CLOSED' } });
    const forgot = await app.inject({ method: 'POST', url: '/patient-auth/forgot-password', payload: { identifier: closedAccount.portableId } });
    expect(forgot.statusCode).toBe(200);
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});
