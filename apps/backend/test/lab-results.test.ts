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

type Role = 'ADMIN' | 'DOCTOR' | 'NURSE' | 'PHARMACIST' | 'STAFF' | 'LAB_TECH';

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

async function facility() {
  const clinic = await seedClinic();
  const users = {} as Record<Role, { id: string; token: string }>;
  for (const role of ['ADMIN', 'DOCTOR', 'NURSE', 'PHARMACIST', 'STAFF', 'LAB_TECH'] as Role[]) {
    const { user, password } = await seedUser({ clinicId: clinic.id, role, name: `${role} person` });
    users[role] = { id: user.id, token: (await loginAs(app, user.email, password)).token };
  }
  // A patient with an active portal account, so we can see when they are told.
  const account = await prisma.patientAccount.create({
    data: { portableId: 'BLM-P-LAB001', phone: '0700', phoneKey: '700', email: 'patient@example.com', password: 'x', status: 'ACTIVE', mustResetPassword: false, createdByClinicId: clinic.id, createdByUserId: users.NURSE.id },
  });
  const patient = await prisma.patient.create({ data: { name: 'Achieng Mary', phone: '0700', clinicId: clinic.id, patientAccountId: account.id } });
  return { clinic, users, patient, account };
}

const order = async (token: string, patientId: string) =>
  (await app.inject({ method: 'POST', url: '/lab', headers: authHeader(token), payload: { patientId, testName: 'Malaria RDT', orderedBy: 'Dr Okello' } })).json().test.id as string;
const enter = (token: string, id: string, results: string) =>
  app.inject({ method: 'PATCH', url: `/lab/${id}`, headers: authHeader(token), payload: { results, status: 'COMPLETED' } });
const verify = (token: string, id: string) => app.inject({ method: 'POST', url: `/lab/${id}/verify`, headers: authHeader(token) });
const patientTold = (accountId: string) => prisma.notification.count({ where: { patientAccountId: accountId, type: 'LAB_RESULT_READY' } });

describe('lab results: entered, verified, then released', () => {
  it('records who entered the result, asks the ordering clinician to verify it, and only then tells the patient', async () => {
    const { clinic, users, patient, account } = await facility();
    const id = await order(users.DOCTOR.token, patient.id);
    // The new order reaches the lab technician.
    expect(await prisma.notification.count({ where: { userId: users.LAB_TECH.id, type: 'LAB_TEST_ORDERED' } })).toBe(1);

    const entered = await enter(users.LAB_TECH.token, id, ' Positive (P. falciparum) ');
    expect(entered.statusCode).toBe(200);
    expect(entered.json().test).toMatchObject({ results: 'Positive (P. falciparum)', status: 'COMPLETED', resultedBy: { name: 'LAB_TECH person', role: 'LAB_TECH' }, verifiedAt: null });
    expect(await prisma.notification.count({ where: { userId: users.DOCTOR.id, type: 'LAB_RESULT_AVAILABLE' } })).toBe(1);
    expect(await patientTold(account.id)).toBe(0);

    const verified = await verify(users.DOCTOR.token, id);
    expect(verified.statusCode).toBe(200);
    expect(verified.json().test.verifiedBy).toMatchObject({ name: 'DOCTOR person' });
    expect(await patientTold(account.id)).toBe(1);

    const audit = await prisma.auditLog.findMany({ where: { entity: 'LabTest', recordId: id }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((a) => (a.metadata as any).result)).toEqual(['entered', 'verified']);
    expect(audit.map((a) => a.actorUserId)).toEqual([users.LAB_TECH.id, users.DOCTOR.id]);

    // The whole facility's tests in one request, with who entered and verified each.
    const list = await app.inject({ method: 'GET', url: `/lab/clinic/${clinic.id}`, headers: authHeader(users.NURSE.token) });
    expect(list.json().tests[0]).toMatchObject({ resultedBy: { name: 'LAB_TECH person' }, verifiedBy: { name: 'DOCTOR person' }, patient: { name: 'Achieng Mary' } });
  });

  it('locks a verified result: correcting it is an amendment with a reason, which needs verifying again', async () => {
    const { users, patient, account } = await facility();
    const id = await order(users.DOCTOR.token, patient.id);
    await enter(users.LAB_TECH.token, id, 'Negative');
    await verify(users.DOCTOR.token, id);

    expect((await enter(users.LAB_TECH.token, id, 'Positive')).statusCode).toBe(409);
    const amend = (body: object, token = users.DOCTOR.token) => app.inject({ method: 'POST', url: `/lab/${id}/amend`, headers: authHeader(token), payload: body });
    expect((await amend({ results: 'Positive' })).statusCode).toBe(400);
    expect((await amend({ results: 'Positive', reason: 'Wrong sample read' }, users.LAB_TECH.token)).statusCode).toBe(403);

    const amended = await amend({ results: 'Positive', reason: 'Wrong sample read' });
    expect(amended.statusCode).toBe(200);
    expect(amended.json().test).toMatchObject({ results: 'Positive', verifiedAt: null });
    const audit = await prisma.auditLog.findFirst({ where: { entity: 'LabTest', recordId: id }, orderBy: { createdAt: 'desc' } });
    expect(audit?.metadata).toMatchObject({ result: 'amended after verification', reason: 'Wrong sample read' });

    expect((await verify(users.ADMIN.token, id)).statusCode).toBe(200);
    expect(await patientTold(account.id)).toBe(2);
  });

  it('can be corrected freely before verification, but never left empty', async () => {
    const { users, patient } = await facility();
    const id = await order(users.DOCTOR.token, patient.id);
    expect((await enter(users.LAB_TECH.token, id, '   ')).statusCode).toBe(400);
    expect((await verify(users.DOCTOR.token, id)).statusCode).toBe(409);
    await enter(users.LAB_TECH.token, id, '12.1 g/dl');
    expect((await enter(users.NURSE.token, id, '12.1 g/dL')).statusCode).toBe(200);
    // The ordering clinician was asked to review once, not for every correction.
    expect(await prisma.notification.count({ where: { userId: users.DOCTOR.id, type: 'LAB_RESULT_AVAILABLE' } })).toBe(1);
  });

  it('lets only the lab technician, nurses and clinicians enter results - and only clinicians verify', async () => {
    const { users, patient } = await facility();
    const id = await order(users.DOCTOR.token, patient.id);
    expect((await enter(users.PHARMACIST.token, id, 'x')).statusCode).toBe(403);
    expect((await enter(users.STAFF.token, id, 'x')).statusCode).toBe(403);
    await enter(users.LAB_TECH.token, id, 'Negative');
    expect((await verify(users.LAB_TECH.token, id)).statusCode).toBe(403);
    expect((await verify(users.NURSE.token, id)).statusCode).toBe(403);
  });

  it('a test can be cancelled while waiting, not once it has a result', async () => {
    const { users, patient } = await facility();
    const waiting = await order(users.DOCTOR.token, patient.id);
    expect((await app.inject({ method: 'PATCH', url: `/lab/${waiting}`, headers: authHeader(users.LAB_TECH.token), payload: { status: 'CANCELLED' } })).statusCode).toBe(200);
    const done = await order(users.DOCTOR.token, patient.id);
    await enter(users.LAB_TECH.token, done, 'Negative');
    expect((await app.inject({ method: 'PATCH', url: `/lab/${done}`, headers: authHeader(users.LAB_TECH.token), payload: { status: 'CANCELLED' } })).statusCode).toBe(409);
  });

  it('ignores results sent through offline sync - they go through the steps above', async () => {
    const { clinic, users, patient, account } = await facility();
    const push = (payload: object) => app.inject({
      method: 'POST', url: '/sync/push', headers: authHeader(users.NURSE.token),
      payload: { operations: [{ id: `m-${Math.random()}`, entity: 'labTest', clinicId: clinic.id, payload: { id: 'lab-offline', patientId: patient.id, testName: 'Hb', orderedBy: 'x', updatedAt: new Date().toISOString(), ...payload } }] },
    });
    await push({ results: 'Smuggled', status: 'COMPLETED', completedAt: new Date().toISOString() });
    const stored = await prisma.labTest.findUniqueOrThrow({ where: { id: 'lab-offline' } });
    expect(stored).toMatchObject({ results: '', status: 'PENDING', completedAt: null });
    await push({ results: 'Smuggled again', status: 'COMPLETED', updatedAt: new Date(Date.now() + 1000).toISOString() });
    expect((await prisma.labTest.findUniqueOrThrow({ where: { id: 'lab-offline' } })).status).toBe('PENDING');
    expect(await patientTold(account.id)).toBe(0);
  });
});

describe('visits: who recorded each one', () => {
  it('records the clinician on the visit and in the activity log - online and from offline sync', async () => {
    const { clinic, users, patient } = await facility();
    const appointment = await prisma.appointment.create({ data: { patientId: patient.id, doctorId: users.DOCTOR.id, clinicId: clinic.id, date: new Date(), time: '09:00' } });
    const online = await app.inject({
      method: 'POST', url: '/consultations', headers: authHeader(users.NURSE.token),
      payload: { appointmentId: appointment.id, patientId: patient.id, symptoms: 'Fever', diagnosis: 'Malaria', clinicalNotes: 'Seen by the nurse' },
    });
    expect(online.statusCode).toBe(200);
    const visit = await prisma.consultation.findUniqueOrThrow({ where: { id: online.json().consultation.id } });
    expect(visit.recordedByUserId).toBe(users.NURSE.id);
    expect(await prisma.auditLog.count({ where: { entity: 'Consultation', recordId: visit.id, action: 'CREATE', actorUserId: users.NURSE.id } })).toBe(1);

    const second = await prisma.appointment.create({ data: { patientId: patient.id, doctorId: users.DOCTOR.id, clinicId: clinic.id, date: new Date(), time: '10:00' } });
    await app.inject({
      method: 'POST', url: '/sync/push', headers: authHeader(users.DOCTOR.token),
      payload: { operations: [{ id: 'm-visit', entity: 'consultation', clinicId: clinic.id, payload: { id: 'c-offline', appointmentId: second.id, patientId: patient.id, symptoms: 'Cough', diagnoses: [{ description: 'Bronchitis' }], updatedAt: new Date().toISOString() } }] },
    });
    expect((await prisma.consultation.findUniqueOrThrow({ where: { id: 'c-offline' } })).recordedByUserId).toBe(users.DOCTOR.id);
    expect(await prisma.auditLog.count({ where: { entity: 'Consultation', recordId: 'c-offline', actorUserId: users.DOCTOR.id } })).toBe(1);
  });
});

describe('the lab technician role', () => {
  it('can be given by an administrator, and an account with lab work is kept (deactivated, not deleted)', async () => {
    const { clinic, users, patient } = await facility();
    const created = await app.inject({
      method: 'POST', url: '/users', headers: authHeader(users.ADMIN.token),
      payload: { email: 'lab2@clinic.ug', password: 'long-enough-1', name: 'Second Lab Tech', role: 'LAB_TECH', clinicId: clinic.id },
    });
    expect(created.statusCode).toBe(200);
    const id = await order(users.DOCTOR.token, patient.id);
    await enter(users.LAB_TECH.token, id, 'Negative');
    const del = await app.inject({ method: 'DELETE', url: `/users/${users.LAB_TECH.id}`, headers: authHeader(users.ADMIN.token) });
    expect(del.statusCode).toBe(409);
    expect(del.json().error).toMatch(/lab results/);
  });
});
