import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

describe('consultation routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates a consultation for an appointment in the caller clinic', async () => {
    const clinic = await seedClinic();
    const { user: doctor, password } = await seedUser({ clinicId: clinic.id, role: 'DOCTOR' });
    const { token } = await loginAs(app, doctor.email, password);
    const patient = await prisma.patient.create({ data: { name: 'P', phone: '0700', clinicId: clinic.id } });
    const appointment = await prisma.appointment.create({
      data: { patientId: patient.id, doctorId: doctor.id, clinicId: clinic.id, date: new Date(), time: '09:00' },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/consultations',
      headers: authHeader(token),
      payload: { appointmentId: appointment.id, patientId: patient.id, diagnosis: 'Malaria', symptoms: 'Fever', prescriptions: [] },
    });

    expect(response.statusCode).toBe(200);
  });

  it('rejects creating a consultation against another clinic appointment', async () => {
    const clinicA = await seedClinic({ name: 'A' });
    const clinicB = await seedClinic({ name: 'B' });
    const { user: doctorB } = await seedUser({ clinicId: clinicB.id, role: 'DOCTOR' });
    const patientB = await prisma.patient.create({ data: { name: 'P', phone: '0700', clinicId: clinicB.id } });
    const appointmentB = await prisma.appointment.create({
      data: { patientId: patientB.id, doctorId: doctorB.id, clinicId: clinicB.id, date: new Date(), time: '09:00' },
    });

    const { user: doctorA, password } = await seedUser({ clinicId: clinicA.id, role: 'DOCTOR' });
    const { token } = await loginAs(app, doctorA.email, password);

    const response = await app.inject({
      method: 'POST',
      url: '/consultations',
      headers: authHeader(token),
      payload: { appointmentId: appointmentB.id, patientId: patientB.id, diagnosis: 'X', symptoms: 'Y', prescriptions: [] },
    });

    expect(response.statusCode).toBe(403);
    const count = await prisma.consultation.count();
    expect(count).toBe(0);
  });

  it('rejects reading consultation history for another clinic patient', async () => {
    const clinicA = await seedClinic({ name: 'A' });
    const clinicB = await seedClinic({ name: 'B' });
    const patientB = await prisma.patient.create({ data: { name: 'P', phone: '0700', clinicId: clinicB.id } });
    const { user: staffA, password } = await seedUser({ clinicId: clinicA.id, role: 'STAFF' });
    const { token } = await loginAs(app, staffA.email, password);

    const response = await app.inject({
      method: 'GET',
      url: `/consultations/patient/${patientB.id}`,
      headers: authHeader(token),
    });
    expect(response.statusCode).toBe(403);
  });
});
