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

async function opd() {
  const clinic = await seedClinic({ name: 'Amolatar Community Medical Centre' });
  const signIn = async (role: 'DOCTOR' | 'STAFF', name: string) => {
    const { user, password } = await seedUser({ clinicId: clinic.id, role, name });
    return { id: user.id, token: (await loginAs(app, user.email, password)).token };
  };
  const doctor = await signIn('DOCTOR', 'Dr Ogwang Peter');
  const desk = await signIn('STAFF', 'Akello Front Desk');
  const patient = await prisma.patient.create({ data: { name: 'Okot John', phone: '0700', clinicId: clinic.id } });
  return { clinic, doctor, desk, patient };
}

const VISIT = {
  symptoms: 'Fever and headache for 3 days',
  history: 'Fever on and off, worse at night. No cough. Not on any medicines. No known chronic illness.',
  examination: 'Febrile, mildly pale, not jaundiced. Chest clear. Abdomen soft, no hepatosplenomegaly.',
  vitals: { temperatureC: 38.6, pulse: 104, respiratoryRate: 20, systolic: 118, diastolic: 76, spo2: 97, weightKg: 62 },
  diagnoses: [{ icd10Code: 'B54', description: 'Malaria' }],
};

describe('a fuller visit note', () => {
  it('keeps the history, the examination findings and the vital signs, and the patient leaves the queue', async () => {
    const { clinic, doctor, patient } = await opd();
    const appointment = await prisma.appointment.create({ data: { patientId: patient.id, doctorId: doctor.id, clinicId: clinic.id, date: new Date(), time: '09:00', checkedInAt: new Date() } });
    const res = await app.inject({ method: 'POST', url: '/consultations', headers: authHeader(doctor.token), payload: { appointmentId: appointment.id, patientId: patient.id, ...VISIT } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().consultation).toMatchObject({ history: VISIT.history, examination: VISIT.examination, vitals: VISIT.vitals });
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe('COMPLETED');
  });

  it('refuses vital signs that cannot be right', async () => {
    const { clinic, doctor, patient } = await opd();
    const appointment = await prisma.appointment.create({ data: { patientId: patient.id, doctorId: doctor.id, clinicId: clinic.id, date: new Date(), time: '09:00' } });
    const res = await app.inject({ method: 'POST', url: '/consultations', headers: authHeader(doctor.token), payload: { appointmentId: appointment.id, patientId: patient.id, ...VISIT, vitals: { temperatureC: 386 } } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Temperature/);
    expect(await prisma.consultation.count()).toBe(0);
  });
});

describe('the waiting queue, from a device that may be offline', () => {
  it('keeps when the patient arrived, and a visit recorded later completes the appointment', async () => {
    const { clinic, doctor, desk, patient } = await opd();
    const arrived = new Date(Date.now() - 25 * 60 * 1000).toISOString();
    const push = (token: string, operations: object[]) => app.inject({ method: 'POST', url: '/sync/push', headers: authHeader(token), payload: { operations } });

    // Reception books the walk-in and checks them in.
    await push(desk.token, [{ id: 'm1', entity: 'appointment', clinicId: clinic.id, payload: { id: 'apt-walk-in', patientId: patient.id, doctorId: doctor.id, clinicId: clinic.id, date: new Date().toISOString(), time: '09:05', status: 'SCHEDULED', checkedInAt: arrived } }]);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: 'apt-walk-in' } })).checkedInAt?.toISOString()).toBe(arrived);

    // The clinician sees them; history, examination and vitals travel with the visit.
    const res = await push(doctor.token, [{ id: 'm2', entity: 'consultation', clinicId: clinic.id, payload: { id: 'visit-1', appointmentId: 'apt-walk-in', patientId: patient.id, ...VISIT } }]);
    expect(res.json().applied).toHaveLength(1);
    expect(await prisma.consultation.findUniqueOrThrow({ where: { id: 'visit-1' } })).toMatchObject({ history: VISIT.history, examination: VISIT.examination, vitals: VISIT.vitals });
    expect(await prisma.appointment.findUniqueOrThrow({ where: { id: 'apt-walk-in' } })).toMatchObject({ status: 'COMPLETED' });

    // A later edit of the appointment from a device that never knew the arrival time leaves it be.
    await push(desk.token, [{ id: 'm3', entity: 'appointment', clinicId: clinic.id, payload: { id: 'apt-walk-in', patientId: patient.id, doctorId: doctor.id, clinicId: clinic.id, date: new Date().toISOString(), time: '09:05', status: 'COMPLETED' } }]);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: 'apt-walk-in' } })).checkedInAt?.toISOString()).toBe(arrived);
  });
});
