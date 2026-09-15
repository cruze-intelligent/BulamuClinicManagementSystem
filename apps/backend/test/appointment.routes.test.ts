import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

describe('appointment routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates and lists appointments within the caller clinic', async () => {
    const clinic = await seedClinic();
    const { user: staff, password } = await seedUser({ clinicId: clinic.id, role: 'STAFF' });
    const { user: doctor } = await seedUser({ clinicId: clinic.id, role: 'DOCTOR' });
    const { token } = await loginAs(app, staff.email, password);

    const patient = await prisma.patient.create({ data: { name: 'Amos', phone: '0700', clinicId: clinic.id } });

    const createResponse = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: authHeader(token),
      payload: { patientId: patient.id, doctorId: doctor.id, clinicId: clinic.id, date: '2026-01-05', time: '09:00' },
    });
    expect(createResponse.statusCode).toBe(200);

    const listResponse = await app.inject({
      method: 'GET',
      url: `/appointments/${clinic.id}`,
      headers: authHeader(token),
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().appointments).toHaveLength(1);
  });

  it('rejects creating an appointment under another clinic', async () => {
    const clinicA = await seedClinic({ name: 'A' });
    const clinicB = await seedClinic({ name: 'B' });
    const { user: staff, password } = await seedUser({ clinicId: clinicA.id, role: 'STAFF' });
    const { user: doctor } = await seedUser({ clinicId: clinicB.id, role: 'DOCTOR' });
    const { token } = await loginAs(app, staff.email, password);
    const patient = await prisma.patient.create({ data: { name: 'X', phone: '0700', clinicId: clinicB.id } });

    const response = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: authHeader(token),
      payload: { patientId: patient.id, doctorId: doctor.id, clinicId: clinicB.id, date: '2026-01-05', time: '09:00' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('rejects updating an appointment that belongs to another clinic', async () => {
    const clinicA = await seedClinic({ name: 'A' });
    const clinicB = await seedClinic({ name: 'B' });
    const { user: doctorB } = await seedUser({ clinicId: clinicB.id, role: 'DOCTOR' });
    const patientB = await prisma.patient.create({ data: { name: 'Y', phone: '0700', clinicId: clinicB.id } });
    const appointmentB = await prisma.appointment.create({
      data: { patientId: patientB.id, doctorId: doctorB.id, clinicId: clinicB.id, date: new Date('2026-01-05'), time: '09:00' },
    });

    const { user: staffA, password } = await seedUser({ clinicId: clinicA.id, role: 'STAFF' });
    const { token } = await loginAs(app, staffA.email, password);

    const response = await app.inject({
      method: 'PATCH',
      url: `/appointments/${appointmentB.id}`,
      headers: authHeader(token),
      payload: { status: 'CANCELLED' },
    });

    expect(response.statusCode).toBe(403);

    const stillScheduled = await prisma.appointment.findUnique({ where: { id: appointmentB.id } });
    expect(stillScheduled?.status).toBe('SCHEDULED');
  });
});
