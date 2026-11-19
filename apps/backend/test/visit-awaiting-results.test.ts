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
