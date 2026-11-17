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

vi.setConfig({ testTimeout: 60_000 });

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

async function hospital() {
  const clinic = await seedClinic({ name: 'Amolatar Community Medical Centre' });
  const signIn = async (role: 'ADMIN' | 'DOCTOR' | 'STAFF' | 'RADIOGRAPHER', name: string) => {
    const { user, password } = await seedUser({ clinicId: clinic.id, role, name });
    return { id: user.id, token: (await loginAs(app, user.email, password)).token };
  };
  const admin = await signIn('ADMIN', 'Okello Administrator');
  const doctor = await signIn('DOCTOR', 'Dr Ogwang Peter');
  const desk = await signIn('STAFF', 'Akello Front Desk');
  const sonographer = await signIn('RADIOGRAPHER', 'Auma Sonographer');
  const patient = await prisma.patient.create({ data: { name: 'Achieng Mary', phone: '0700', sex: 'FEMALE', clinicId: clinic.id } });
  return { clinic, admin, doctor, desk, sonographer, patient };
}

const post = (token: string, url: string, payload: object) => app.inject({ method: 'POST', url, headers: authHeader(token), payload });
const notified = (userId: string, type: string) => prisma.notification.count({ where: { userId, type: type as any } });

describe('imaging', () => {
  it('is requested by a clinician, goes to the imaging unit, is reported by the sonographer, and the requester is told', async () => {
    const { admin, doctor, desk, sonographer, patient } = await hospital();
    const radiology = (await post(admin.token, '/departments', { code: 'RADIOLOGY' })).json().department;
    const ultrasound = (await post(admin.token, '/departments', { code: 'ULTRASOUND' })).json().department;

    // The requester chooses the kind and writes the examination in their own words.
    expect((await post(doctor.token, '/imaging', { patientId: patient.id, modality: 'ULTRASOUND', examination: '' })).statusCode).toBe(400);
    expect((await post(doctor.token, '/imaging', { patientId: patient.id, modality: 'PHOTOGRAPH', examination: 'Selfie' })).statusCode).toBe(400);
    expect((await post(desk.token, '/imaging', { patientId: patient.id, modality: 'XRAY', examination: 'Chest X-ray' })).statusCode).toBe(403);

    const scan = await post(doctor.token, '/imaging', { patientId: patient.id, modality: 'ULTRASOUND', examination: 'Abdominal ultrasound', clinicalInfo: 'RUQ pain, ?gallstones' });
    expect(scan.statusCode, scan.body).toBe(200);
    expect(scan.json().request).toMatchObject({ status: 'REQUESTED', requestedBy: 'Dr Ogwang Peter', unit: { id: ultrasound.id } });
    const xray = await post(doctor.token, '/imaging', { patientId: patient.id, modality: 'XRAY', examination: 'Chest X-ray (PA)', urgent: true });
    expect(xray.json().request.unit).toMatchObject({ id: radiology.id });
    expect(await notified(sonographer.id, 'IMAGING_REQUESTED')).toBe(2);

    // The worklist: urgent first.
    const list = (await app.inject({ method: 'GET', url: '/imaging', headers: authHeader(sonographer.token) })).json().requests;
    expect(list.map((r: any) => r.examination)).toEqual(['Chest X-ray (PA)', 'Abdominal ultrasound']);
    expect((await app.inject({ method: 'GET', url: `/imaging?unitId=${ultrasound.id}`, headers: authHeader(sonographer.token) })).json().requests).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/imaging', headers: authHeader(desk.token) })).statusCode).toBe(403);

    // The report needs findings and an impression.
    const id = scan.json().request.id;
    const report = (payload: object, token = sonographer.token) => app.inject({ method: 'PATCH', url: `/imaging/${id}/report`, headers: authHeader(token), payload });
    expect((await report({ findings: 'Several echogenic foci in the gallbladder with acoustic shadowing.' })).statusCode).toBe(400);
    expect((await report({ findings: 'x', impression: 'y' }, desk.token)).statusCode).toBe(403);
    const done = await report({ findings: 'Several echogenic foci in the gallbladder with acoustic shadowing. Wall not thickened.', impression: 'Cholelithiasis without cholecystitis' });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().request).toMatchObject({ status: 'REPORTED', reportedBy: 'Auma Sonographer', impression: 'Cholelithiasis without cholecystitis' });
    expect(await notified(doctor.id, 'IMAGING_REPORTED')).toBe(1);

    // A reported request can not be cancelled; a waiting one can, with a reason.
    expect((await post(doctor.token, `/imaging/${id}/cancel`, { reason: 'No longer needed' })).statusCode).toBe(409);
    const xrayId = xray.json().request.id;
    expect((await post(doctor.token, `/imaging/${xrayId}/cancel`, {})).statusCode).toBe(400);
    expect((await post(doctor.token, `/imaging/${xrayId}/cancel`, { reason: 'Requested in error' })).json().request).toMatchObject({ status: 'CANCELLED', cancelReason: 'Requested in error' });
  });

  it('requested at a visit arrives with the visit, once, and is in the clinical summary', async () => {
    const { clinic, doctor, desk, sonographer, patient } = await hospital();
    const appointment = await prisma.appointment.create({ data: { patientId: patient.id, doctorId: doctor.id, clinicId: clinic.id, date: new Date(), time: '09:00' } });
    const push = (token: string, operations: object[]) => post(token, '/sync/push', { operations });
    await push(doctor.token, [{ id: 'm1', entity: 'consultation', clinicId: clinic.id, payload: { id: 'visit-1', appointmentId: appointment.id, patientId: patient.id, symptoms: 'Abdominal pain', diagnoses: [{ description: 'Biliary colic' }] } }]);
    const imaging = { id: 'img-1', patientId: patient.id, consultationId: 'visit-1', modality: 'ULTRASOUND', examination: 'Abdominal ultrasound', clinicalInfo: 'RUQ pain', urgent: false, createdAt: new Date().toISOString() };
    const sent = await push(doctor.token, [{ id: 'm2', entity: 'imagingRequest', clinicId: clinic.id, payload: imaging }]);
    expect(sent.json().applied).toHaveLength(1);
    await push(doctor.token, [{ id: 'm3', entity: 'imagingRequest', clinicId: clinic.id, payload: imaging }]);
    // Front desk staff can not request imaging, even from a device.
    await push(desk.token, [{ id: 'm4', entity: 'imagingRequest', clinicId: clinic.id, payload: { ...imaging, id: 'img-2' } }]);
    expect(await prisma.imagingRequest.count()).toBe(1);
    expect(await prisma.imagingRequest.findUniqueOrThrow({ where: { id: 'img-1' } })).toMatchObject({ consultationId: 'visit-1', requestedBy: 'Dr Ogwang Peter', status: 'REQUESTED' });
    expect(await notified(sonographer.id, 'IMAGING_REQUESTED')).toBe(1);

    await app.inject({ method: 'PATCH', url: '/imaging/img-1/report', headers: authHeader(sonographer.token), payload: { findings: 'Gallstones.', impression: 'Cholelithiasis' } });
    const summary = (await app.inject({ method: 'GET', url: `/patients/${patient.id}/clinical-summary`, headers: authHeader(doctor.token) })).json();
    const visit = (summary.summary ?? summary).visits[0];
    expect(visit.imaging).toEqual(['Abdominal ultrasound (Ultrasound scan): Cholelithiasis']);
  });

  it('has its own staff role, which an administrator gives', async () => {
    const { clinic, admin } = await hospital();
    const res = await post(admin.token, '/users', { clinicId: clinic.id, name: 'Okot Radiographer', email: 'okot.radiographer@example.org', password: 'StrongPass123!', role: 'RADIOGRAPHER' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().user.role).toBe('RADIOGRAPHER');
  });
});

describe('a patient who steps out of the waiting queue', () => {
  it('keeps their arrival time and is marked away, then back', async () => {
    const { clinic, doctor, desk, patient } = await hospital();
    const arrived = new Date(Date.now() - 30 * 60_000).toISOString();
    const now = Date.now();
    const op = (n: number, awayAt: string | null) => ({
      id: `m-away-${n}`, entity: 'appointment', clinicId: clinic.id,
      payload: { id: 'apt-1', patientId: patient.id, doctorId: doctor.id, clinicId: clinic.id, date: arrived, time: '09:00', status: 'SCHEDULED', checkedInAt: arrived, awayAt, updatedAt: new Date(now + n * 1000).toISOString() },
    });
    await post(desk.token, '/sync/push', { operations: [op(1, null)] });
    const away = new Date(now - 60_000).toISOString();
    await post(desk.token, '/sync/push', { operations: [op(2, away)] });
    expect(await prisma.appointment.findUniqueOrThrow({ where: { id: 'apt-1' } })).toMatchObject({ awayAt: new Date(away), checkedInAt: new Date(arrived) });
    await post(desk.token, '/sync/push', { operations: [op(3, null)] });
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: 'apt-1' } })).awayAt).toBeNull();
  });
});
