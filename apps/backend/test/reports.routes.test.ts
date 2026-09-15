import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

describe('reports routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rejects a report request for another clinic', async () => {
    const clinicA = await seedClinic({ name: 'A' });
    const clinicB = await seedClinic({ name: 'B' });
    const { user, password } = await seedUser({ clinicId: clinicA.id, role: 'ADMIN' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({
      method: 'GET',
      url: `/reports/hmis-105/${clinicB.id}`,
      headers: authHeader(token),
    });
    expect(response.statusCode).toBe(403);
  });

  it('computes HMIS 105 family planning and maternal health sections from reproductive-health records', async () => {
    const clinic = await seedClinic();
    const { user: nurse, password } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const { token } = await loginAs(app, nurse.email, password);

    const patient = await prisma.patient.create({
      data: { name: 'Female Patient', phone: '0700', clinicId: clinic.id, sex: 'FEMALE' },
    });

    await prisma.reproductiveHealthRecord.create({
      data: {
        patientId: patient.id,
        recordedById: nurse.id,
        familyPlanningMethod: 'PILL',
        pregnancyStatus: 'PREGNANT',
      },
    });
    await prisma.reproductiveHealthRecord.create({
      data: {
        patientId: patient.id,
        recordedById: nurse.id,
        familyPlanningMethod: 'PILL',
        pregnancyStatus: 'POSTPARTUM',
      },
    });

    const now = new Date();
    const response = await app.inject({
      method: 'GET',
      url: `/reports/hmis-105/${clinic.id}?month=${now.getMonth() + 1}&year=${now.getFullYear()}`,
      headers: authHeader(token),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.section4_familyPlanning.totalRecorded).toBe(2);
    expect(body.section4_familyPlanning.byMethod.PILL).toBe(2);
    expect(body.section5_maternalHealth.pregnantClients).toBe(1);
    expect(body.section5_maternalHealth.postpartumClients).toBe(1);
  });

  it('rejects STAFF from the ADMIN/DOCTOR-only monthly report', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'STAFF' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({ method: 'GET', url: `/reports/monthly/${clinic.id}`, headers: authHeader(token) });
    expect(response.statusCode).toBe(403);
  });
});
