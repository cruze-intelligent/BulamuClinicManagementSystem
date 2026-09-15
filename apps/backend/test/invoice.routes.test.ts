import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

async function seedInvoice(clinicId: string) {
  const patient = await prisma.patient.create({ data: { name: 'P', phone: '0700', clinicId } });
  const doctor = await prisma.user.create({
    data: { email: `doc-${Math.random()}@t.ug`, password: 'x', name: 'Doc', role: 'DOCTOR', clinicId },
  });
  const appointment = await prisma.appointment.create({
    data: { patientId: patient.id, doctorId: doctor.id, clinicId, date: new Date(), time: '09:00' },
  });
  const consultation = await prisma.consultation.create({
    data: { appointmentId: appointment.id, patientId: patient.id, diagnosis: 'Malaria', symptoms: 'Fever' },
  });
  return prisma.invoice.create({ data: { consultationId: consultation.id, clinicId, amount: 5000 } });
}

describe('invoice routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lists invoices for the caller clinic', async () => {
    const clinic = await seedClinic();
    await seedInvoice(clinic.id);
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({ method: 'GET', url: `/invoices/${clinic.id}`, headers: authHeader(token) });
    expect(response.statusCode).toBe(200);
    expect(response.json().invoices).toHaveLength(1);
  });

  it('rejects listing invoices for another clinic', async () => {
    const clinicA = await seedClinic({ name: 'A' });
    const clinicB = await seedClinic({ name: 'B' });
    await seedInvoice(clinicB.id);
    const { user, password } = await seedUser({ clinicId: clinicA.id, role: 'ADMIN' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({ method: 'GET', url: `/invoices/${clinicB.id}`, headers: authHeader(token) });
    expect(response.statusCode).toBe(403);
  });

  it('rejects marking another clinic invoice as paid', async () => {
    const clinicA = await seedClinic({ name: 'A' });
    const clinicB = await seedClinic({ name: 'B' });
    const invoiceB = await seedInvoice(clinicB.id);
    const { user, password } = await seedUser({ clinicId: clinicA.id, role: 'ADMIN' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({
      method: 'PATCH',
      url: `/invoices/${invoiceB.id}/pay`,
      headers: authHeader(token),
    });
    expect(response.statusCode).toBe(403);

    const stillPending = await prisma.invoice.findUnique({ where: { id: invoiceB.id } });
    expect(stillPending?.status).toBe('PENDING');
  });

  it('rejects STAFF from marking invoices paid (role gate)', async () => {
    const clinic = await seedClinic();
    const invoice = await seedInvoice(clinic.id);
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'STAFF' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({
      method: 'PATCH',
      url: `/invoices/${invoice.id}/pay`,
      headers: authHeader(token),
    });
    expect(response.statusCode).toBe(403);
  });
});
