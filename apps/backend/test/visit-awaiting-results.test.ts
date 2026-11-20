import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp();
});
afterAll(async () => {
  await app?.close();
});
beforeEach(async () => {
  await resetDb();
});

const push = (token: string, entity: string, payload: Record<string, unknown>, updatedAt = new Date()) => app.inject({
  method: 'POST', url: '/sync/push', headers: authHeader(token),
  payload: { operations: [{ id: randomUUID(), entity, action: 'upsert', recordId: payload.id, payload: { updatedAt: updatedAt.toISOString(), ...payload }, createdAt: new Date().toISOString(), attempts: 0 }] },
});

describe('a visit saved with tests sent, finished when the results are in', () => {
  it('is saved without a diagnosis while it waits, the result leads back to it, and finishing it tells the pharmacist', async () => {
    const clinic = await seedClinic();
    const { user: doctor, password } = await seedUser({ clinicId: clinic.id, role: 'DOCTOR' });
    const { token } = await loginAs(app, doctor.email, password);
    const { user: lab, password: labPassword } = await seedUser({ clinicId: clinic.id, role: 'LAB_TECH' });
    const { token: labToken } = await loginAs(app, lab.email, labPassword);
    const { user: pharmacist } = await seedUser({ clinicId: clinic.id, role: 'PHARMACIST' });
    const patient = await prisma.patient.create({ data: { name: 'Achieng Mary', phone: '0700', clinicId: clinic.id } });
    const appointment = await prisma.appointment.create({ data: { patientId: patient.id, clinicId: clinic.id, doctorId: doctor.id, date: new Date(), time: '09:00', status: 'SCHEDULED' } });

    // Sent to the lab first: complaints and examination, no diagnosis yet.
    const visitId = randomUUID();
    const first = await push(token, 'consultation', {
      id: visitId, appointmentId: appointment.id, patientId: patient.id, symptoms: 'Fever 3 days', examination: 'Pale', diagnoses: [], prescriptions: [], awaitingResults: true,
    });
    expect(first.json().applied).toHaveLength(1);
    let visit = await prisma.consultation.findUniqueOrThrow({ where: { id: visitId } });
    expect(visit).toMatchObject({ awaitingResults: true, diagnosis: '' });
    // The patient leaves the waiting queue - the clinician sees others meanwhile.
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe('COMPLETED');

    // A finished visit still needs its diagnosis.
    const bare = await push(token, 'consultation', { id: randomUUID(), appointmentId: appointment.id, patientId: patient.id, symptoms: 'x', diagnoses: [] });
    expect(bare.json().rejected?.[0]?.reason ?? '').not.toBe('');

    const test = await prisma.labTest.create({ data: { patientId: patient.id, consultationId: visitId, testName: 'Malaria blood smear (B/S)', results: '', orderedBy: doctor.name, orderedByUserId: doctor.id } });
    const entered = await app.inject({ method: 'PATCH', url: `/lab/${test.id}`, headers: authHeader(labToken), payload: { results: 'P. falciparum ++', status: 'COMPLETED' } });
    expect(entered.statusCode).toBe(200);
    const told = await prisma.notification.findFirstOrThrow({ where: { userId: doctor.id, type: 'LAB_RESULT_AVAILABLE' } });
    expect(told.link).toBe(`/consultations/record?consultationId=${visitId}&patientId=${patient.id}`);
    expect(told.body).toContain('finish the diagnosis and prescription');

    // Finished: diagnosis and prescription added; the pharmacist hears of it.
    const done = await push(token, 'consultation', {
      id: visitId, appointmentId: appointment.id, patientId: patient.id, symptoms: 'Fever 3 days', examination: 'Pale', awaitingResults: false,
      diagnoses: [{ description: 'Malaria, uncomplicated', icd10Code: 'B54', type: 'PRIMARY' }],
      prescriptions: [{ medication: 'Artemether/Lumefantrine', dosage: '4 tablets', frequency: 'BD', duration: '3 days' }],
    }, new Date(Date.now() + 60_000));
    expect(done.json().applied).toHaveLength(1);
    visit = await prisma.consultation.findUniqueOrThrow({ where: { id: visitId } });
    expect(visit).toMatchObject({ awaitingResults: false, diagnosis: 'Malaria, uncomplicated' });
    expect(await prisma.prescription.count({ where: { consultationId: visitId } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: pharmacist.id, type: 'NEW_PRESCRIPTION' } })).toBe(1);
  });
});

describe('tests and imaging asked for at a visit reach the lab and imaging, whatever order they arrive in', () => {
  it('applies a walk-in, its visit, a test and an imaging request sent in the wrong order, and links them', async () => {
    const clinic = await seedClinic();
    const { user: doctor, password } = await seedUser({ clinicId: clinic.id, role: 'DOCTOR' });
    const { token } = await loginAs(app, doctor.email, password);
    const { user: lab } = await seedUser({ clinicId: clinic.id, role: 'LAB_TECH' });
    const patient = await prisma.patient.create({ data: { name: 'Filder Ogwang', phone: '0700', clinicId: clinic.id } });
    const t = (s: number) => new Date(Date.now() + s * 1000).toISOString();
    const op = (entity: string, payload: Record<string, unknown>, at: string) => ({ id: randomUUID(), entity, action: 'upsert', recordId: payload.id, clinicId: clinic.id, payload: { updatedAt: at, createdAt: at, ...payload }, createdAt: at, attempts: 0 });
    const appointmentId = randomUUID();
    const visitId = randomUUID();
    const testId = randomUUID();
    const imagingId = randomUUID();
    const operations = [
      op('imagingRequest', { id: imagingId, patientId: patient.id, consultationId: visitId, modality: 'ECG', examination: 'Resting 12-lead ECG' }, t(4)),
      op('labTest', { id: testId, patientId: patient.id, consultationId: visitId, testName: 'Random blood sugar (RBS)', results: '', status: 'PENDING', orderedBy: doctor.name }, t(3)),
      op('consultation', { id: visitId, appointmentId, patientId: patient.id, symptoms: 'Dizzy', diagnoses: [], prescriptions: [], awaitingResults: true }, t(2)),
      op('appointment', { id: appointmentId, patientId: patient.id, doctorId: doctor.id, clinicId: clinic.id, date: t(1), time: '10:00', status: 'SCHEDULED', checkedInAt: t(1), notes: 'Walk-in' }, t(1)),
    ];
    const res = await app.inject({ method: 'POST', url: '/sync/push', headers: authHeader(token), payload: { operations } });
    const body = res.json();
    expect(body.rejected).toEqual([]);
    expect(body.applied).toHaveLength(4);
    expect(await prisma.labTest.findUniqueOrThrow({ where: { id: testId } })).toMatchObject({ consultationId: visitId, status: 'PENDING' });
    expect(await prisma.imagingRequest.findUniqueOrThrow({ where: { id: imagingId } })).toMatchObject({ consultationId: visitId });
    expect(await prisma.notification.count({ where: { userId: lab.id, type: 'LAB_TEST_ORDERED' } })).toBe(1);
  });

  it('keeps a test whose visit has not arrived waiting, instead of losing it', async () => {
    const clinic = await seedClinic();
    const { user: doctor, password } = await seedUser({ clinicId: clinic.id, role: 'DOCTOR' });
    const { token } = await loginAs(app, doctor.email, password);
    const patient = await prisma.patient.create({ data: { name: 'Filder Ogwang', phone: '0700', clinicId: clinic.id } });
    const test = { id: randomUUID(), patientId: patient.id, consultationId: randomUUID(), testName: 'Malaria RDT', results: '', orderedBy: doctor.name };
    const res = await push(token, 'labTest', test);
    const body = res.json();
    expect([...body.applied, ...body.done, ...body.rejected]).toEqual([]);
    expect(await prisma.labTest.findUnique({ where: { id: test.id } })).toBeNull();
  });
});
