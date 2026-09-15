import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

describe('soft-delete endpoints', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lets an ADMIN soft-delete a patient in their own clinic', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
    const { token } = await loginAs(app, user.email, password);
    const patient = await prisma.patient.create({ data: { name: 'P', phone: '0700', clinicId: clinic.id } });

    const response = await app.inject({ method: 'DELETE', url: `/patients/${patient.id}`, headers: authHeader(token) });
    expect(response.statusCode).toBe(200);

    const record = await prisma.patient.findUnique({ where: { id: patient.id } });
    expect(record?.deletedAt).not.toBeNull();
  });

  it('rejects STAFF from deleting a patient (ADMIN only)', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'STAFF' });
    const { token } = await loginAs(app, user.email, password);
    const patient = await prisma.patient.create({ data: { name: 'P', phone: '0700', clinicId: clinic.id } });

    const response = await app.inject({ method: 'DELETE', url: `/patients/${patient.id}`, headers: authHeader(token) });
    expect(response.statusCode).toBe(403);
  });

  it('rejects deleting a patient from another clinic', async () => {
    const clinicA = await seedClinic({ name: 'A' });
    const clinicB = await seedClinic({ name: 'B' });
    const { user, password } = await seedUser({ clinicId: clinicA.id, role: 'ADMIN' });
    const { token } = await loginAs(app, user.email, password);
    const patient = await prisma.patient.create({ data: { name: 'P', phone: '0700', clinicId: clinicB.id } });

    const response = await app.inject({ method: 'DELETE', url: `/patients/${patient.id}`, headers: authHeader(token) });
    expect(response.statusCode).toBe(403);
  });

  it('lets a pharmacist remove a discontinued medicine', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'PHARMACIST' });
    const { token } = await loginAs(app, user.email, password);
    const medicine = await prisma.medicine.create({
      data: { clinicId: clinic.id, name: 'Old Stock', quantity: 0, unit: 'unit', reorderLevel: 1, price: 1 },
    });

    const response = await app.inject({ method: 'DELETE', url: `/inventory/${medicine.id}`, headers: authHeader(token) });
    expect(response.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: `/inventory/${clinic.id}`, headers: authHeader(token) });
    expect(list.json().medicines).toHaveLength(0);
  });

  it('deletes a reproductive health record and audits it', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const { token } = await loginAs(app, user.email, password);
    const patient = await prisma.patient.create({ data: { name: 'F', phone: '0700', clinicId: clinic.id, sex: 'FEMALE' } });
    const record = await prisma.reproductiveHealthRecord.create({
      data: { patientId: patient.id, recordedById: user.id, familyPlanningMethod: 'PILL', pregnancyStatus: 'UNKNOWN' },
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/patients/${patient.id}/reproductive-health/${record.id}`,
      headers: authHeader(token),
    });
    expect(response.statusCode).toBe(200);

    const history = await app.inject({
      method: 'GET',
      url: `/patients/${patient.id}/reproductive-health`,
      headers: authHeader(token),
    });
    expect(history.json().records).toHaveLength(0);
  });
});
