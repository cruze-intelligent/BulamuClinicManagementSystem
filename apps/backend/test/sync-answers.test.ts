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

const DAY = 24 * 60 * 60 * 1000;
const op = (entity: string, payload: Record<string, unknown>, patch: Record<string, unknown> = {}) => ({
  id: randomUUID(), entity, action: 'upsert', recordId: payload.id, payload: { updatedAt: new Date().toISOString(), ...payload }, createdAt: new Date().toISOString(), attempts: 0, ...patch,
});

describe('every change a device sends gets an answer, so none waits forever', () => {
  it('applied, done (nothing to do) or rejected with a reason - and a missing dependency waits', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'DOCTOR' });
    const { token } = await loginAs(app, user.email, password);
    const patient = await prisma.patient.create({ data: { name: 'Okello Isaac', phone: '0700', clinicId: clinic.id } });
    const other = await seedClinic({ name: 'Elsewhere' });
    const theirs = await prisma.patient.create({ data: { name: 'Not ours', phone: '0700', clinicId: other.id } });

    const fresh = op('patient', { id: randomUUID(), name: 'New Patient', phone: '0701', clinicId: clinic.id });
    const deleteGone = op('patient', { id: randomUUID() }, { action: 'delete' });
    const foreign = op('patient', { id: theirs.id, name: 'Changed', phone: '0700' });
    const badFee = op('consultation', { id: randomUUID(), appointmentId: 'x', patientId: patient.id });
    const waitsForAppointment = op('consultation', { id: randomUUID(), appointmentId: randomUUID(), patientId: patient.id, diagnosis: 'Malaria' });
    const tooOld = op('labTest', { id: randomUUID(), patientId: randomUUID(), testName: 'Malaria RDT' }, { createdAt: new Date(Date.now() - 8 * DAY).toISOString() });

    const res = await app.inject({
      method: 'POST', url: '/sync/push', headers: authHeader(token),
      payload: { operations: [fresh, deleteGone, foreign, badFee, waitsForAppointment, tooOld] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.applied.map((a: any) => a.mutationId)).toEqual([fresh.id]);
    expect(body.done).toEqual([deleteGone.id]);
    expect(body.rejected).toEqual([
      { mutationId: foreign.id, entity: 'patient', recordId: theirs.id, reason: 'It belongs to another facility or record' },
      { mutationId: tooOld.id, entity: 'labTest', recordId: tooOld.payload.id, reason: 'It belongs to another facility or record' },
    ]);
    // Neither answered: the appointment it belongs to may still be on its way (the same goes for the
    // consultation whose appointment "x" is unknown) - the device keeps them and tries again.
    const answered = new Set([...body.applied.map((a: any) => a.mutationId), ...body.done, ...body.rejected.map((r: any) => r.mutationId)]);
    expect(answered.has(waitsForAppointment.id)).toBe(false);
    expect(answered.has(badFee.id)).toBe(false);
  });
});
