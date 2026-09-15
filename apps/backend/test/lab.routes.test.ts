import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

describe('lab routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('orders and lists a lab test for a patient in the caller clinic', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const { token } = await loginAs(app, user.email, password);
    const patient = await prisma.patient.create({ data: { name: 'P', phone: '0700', clinicId: clinic.id } });

    const create = await app.inject({
      method: 'POST',
      url: '/lab',
      headers: authHeader(token),
      payload: { patientId: patient.id, testName: 'Malaria RDT', orderedBy: user.name },
    });
    expect(create.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: `/lab/patient/${patient.id}`, headers: authHeader(token) });
    expect(list.json().tests).toHaveLength(1);
  });

  it('rejects ordering a lab test for another clinic patient', async () => {
    const clinicA = await seedClinic({ name: 'A' });
    const clinicB = await seedClinic({ name: 'B' });
    const patientB = await prisma.patient.create({ data: { name: 'P', phone: '0700', clinicId: clinicB.id } });
    const { user, password } = await seedUser({ clinicId: clinicA.id, role: 'NURSE' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({
      method: 'POST',
      url: '/lab',
      headers: authHeader(token),
      payload: { patientId: patientB.id, testName: 'Injected', orderedBy: user.name },
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects updating lab results for another clinic test', async () => {
    const clinicA = await seedClinic({ name: 'A' });
    const clinicB = await seedClinic({ name: 'B' });
    const patientB = await prisma.patient.create({ data: { name: 'P', phone: '0700', clinicId: clinicB.id } });
    const test = await prisma.labTest.create({
      data: { patientId: patientB.id, testName: 'X', results: '', orderedBy: 'someone' },
    });
    const { user, password } = await seedUser({ clinicId: clinicA.id, role: 'NURSE' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({
      method: 'PATCH',
      url: `/lab/${test.id}`,
      headers: authHeader(token),
      payload: { results: 'tampered', status: 'COMPLETED' },
    });
    expect(response.statusCode).toBe(403);
  });
});
