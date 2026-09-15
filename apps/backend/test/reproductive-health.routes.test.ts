import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

describe('reproductive health routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lets a NURSE record and retrieve a reproductive health observation', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const { token } = await loginAs(app, user.email, password);
    const patient = await prisma.patient.create({ data: { name: 'F', phone: '0700', clinicId: clinic.id, sex: 'FEMALE' } });

    const create = await app.inject({
      method: 'POST',
      url: `/patients/${patient.id}/reproductive-health`,
      headers: authHeader(token),
      payload: { familyPlanningMethod: 'IMPLANT', pregnancyStatus: 'NOT_PREGNANT', cycleLengthDays: 28 },
    });
    expect(create.statusCode).toBe(200);

    const list = await app.inject({
      method: 'GET',
      url: `/patients/${patient.id}/reproductive-health`,
      headers: authHeader(token),
    });
    expect(list.json().records).toHaveLength(1);
    expect(list.json().records[0].familyPlanningMethod).toBe('IMPLANT');
  });

  it('rejects STAFF from recording a reproductive health observation (role gate)', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'STAFF' });
    const { token } = await loginAs(app, user.email, password);
    const patient = await prisma.patient.create({ data: { name: 'F', phone: '0700', clinicId: clinic.id, sex: 'FEMALE' } });

    const response = await app.inject({
      method: 'POST',
      url: `/patients/${patient.id}/reproductive-health`,
      headers: authHeader(token),
      payload: { familyPlanningMethod: 'NONE', pregnancyStatus: 'UNKNOWN' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects recording a reproductive health observation for another clinic patient', async () => {
    const clinicA = await seedClinic({ name: 'A' });
    const clinicB = await seedClinic({ name: 'B' });
    const patientB = await prisma.patient.create({ data: { name: 'F', phone: '0700', clinicId: clinicB.id, sex: 'FEMALE' } });
    const { user, password } = await seedUser({ clinicId: clinicA.id, role: 'NURSE' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({
      method: 'POST',
      url: `/patients/${patientB.id}/reproductive-health`,
      headers: authHeader(token),
      payload: { familyPlanningMethod: 'NONE', pregnancyStatus: 'UNKNOWN' },
    });
    expect(response.statusCode).toBe(403);
  });
});
