import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

describe('sync routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('applies a valid patient create mutation for the caller own clinic', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'STAFF' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: authHeader(token),
      payload: {
        operations: [
          {
            id: 'mut-1',
            entity: 'patient',
            clinicId: clinic.id,
            payload: { id: 'pat-1', name: 'Offline Patient', phone: '0700', clinicId: clinic.id },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().applied).toHaveLength(1);
  });

  it('silently drops a mutation whose declared clinicId does not match the caller', async () => {
    const clinicA = await seedClinic({ name: 'A' });
    const clinicB = await seedClinic({ name: 'B' });
    const { user, password } = await seedUser({ clinicId: clinicA.id, role: 'STAFF' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: authHeader(token),
      payload: {
        operations: [
          {
            id: 'mut-spoof',
            entity: 'patient',
            clinicId: clinicB.id,
            payload: { id: 'pat-spoof', name: 'Spoofed', phone: '0700', clinicId: clinicB.id },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().applied).toHaveLength(0);
    const created = await prisma.patient.findUnique({ where: { id: 'pat-spoof' } });
    expect(created).toBeNull();
  });

  it('rejects an update mutation targeting a patient that belongs to another clinic (upsert-ownership bypass regression)', async () => {
    const clinicA = await seedClinic({ name: 'A' });
    const clinicB = await seedClinic({ name: 'B' });
    const victim = await prisma.patient.create({ data: { name: 'Original Name', phone: '0700', clinicId: clinicB.id } });

    const { user, password } = await seedUser({ clinicId: clinicA.id, role: 'STAFF' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: authHeader(token),
      payload: {
        operations: [
          {
            id: 'mut-hijack',
            entity: 'patient',
            clinicId: clinicA.id,
            payload: { id: victim.id, name: 'Tampered Name', phone: '0700', clinicId: clinicA.id },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().applied).toHaveLength(0);

    const unchanged = await prisma.patient.findUnique({ where: { id: victim.id } });
    expect(unchanged?.name).toBe('Original Name');
    expect(unchanged?.clinicId).toBe(clinicB.id);
  });

  it('rejects an appointment mutation referencing a patient outside the caller clinic', async () => {
    const clinicA = await seedClinic({ name: 'A' });
    const clinicB = await seedClinic({ name: 'B' });
    const patientB = await prisma.patient.create({ data: { name: 'P', phone: '0700', clinicId: clinicB.id } });
    const doctorA = await prisma.user.create({
      data: { email: `doc-${Math.random()}@t.ug`, password: 'x', name: 'Doc', role: 'DOCTOR', clinicId: clinicA.id },
    });

    const { user, password } = await seedUser({ clinicId: clinicA.id, role: 'STAFF' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: authHeader(token),
      payload: {
        operations: [
          {
            id: 'mut-appt',
            entity: 'appointment',
            clinicId: clinicA.id,
            payload: {
              id: 'appt-1',
              patientId: patientB.id,
              doctorId: doctorA.id,
              clinicId: clinicA.id,
              date: new Date().toISOString(),
              time: '09:00',
            },
          },
        ],
      },
    });

    expect(response.json().applied).toHaveLength(0);
    const created = await prisma.appointment.findUnique({ where: { id: 'appt-1' } });
    expect(created).toBeNull();
  });

  it('rejects a reproductiveHealth mutation referencing a patient outside the caller clinic', async () => {
    const clinicA = await seedClinic({ name: 'A' });
    const clinicB = await seedClinic({ name: 'B' });
    const patientB = await prisma.patient.create({ data: { name: 'P', phone: '0700', clinicId: clinicB.id, sex: 'FEMALE' } });

    const { user, password } = await seedUser({ clinicId: clinicA.id, role: 'NURSE' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: authHeader(token),
      payload: {
        operations: [
          {
            id: 'mut-rh',
            entity: 'reproductiveHealth',
            clinicId: clinicA.id,
            payload: { id: 'rh-1', patientId: patientB.id, familyPlanningMethod: 'PILL', pregnancyStatus: 'NOT_PREGNANT' },
          },
        ],
      },
    });

    expect(response.json().applied).toHaveLength(0);
    const created = await prisma.reproductiveHealthRecord.findUnique({ where: { id: 'rh-1' } });
    expect(created).toBeNull();
  });

  it('rejects pulling deltas for another clinic', async () => {
    const clinicA = await seedClinic({ name: 'A' });
    const clinicB = await seedClinic({ name: 'B' });
    const { user, password } = await seedUser({ clinicId: clinicA.id, role: 'STAFF' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({
      method: 'GET',
      url: `/sync/pull?clinicId=${clinicB.id}`,
      headers: authHeader(token),
    });
    expect(response.statusCode).toBe(403);
  });

  it('pull returns only the caller clinic records', async () => {
    const clinicA = await seedClinic({ name: 'A' });
    const clinicB = await seedClinic({ name: 'B' });
    await prisma.patient.create({ data: { name: 'In A', phone: '0700', clinicId: clinicA.id } });
    await prisma.patient.create({ data: { name: 'In B', phone: '0700', clinicId: clinicB.id } });

    const { user, password } = await seedUser({ clinicId: clinicA.id, role: 'STAFF' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({
      method: 'GET',
      url: `/sync/pull?clinicId=${clinicA.id}`,
      headers: authHeader(token),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.patients).toHaveLength(1);
    expect(body.patients[0].name).toBe('In A');
  });
});
