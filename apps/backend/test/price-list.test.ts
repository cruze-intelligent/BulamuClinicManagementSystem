import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
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

async function staff(clinicId: string, role: 'ADMIN' | 'DOCTOR' | 'STAFF' | 'RADIOGRAPHER') {
  const { user, password } = await seedUser({ clinicId, role });
  return { user, token: (await loginAs(app, user.email, password)).token };
}

/** A facility with a visit in its Dentistry unit, billed for nothing yet but a lab test. */
async function facility() {
  const clinic = await seedClinic();
  const [admin, doctor, desk] = await Promise.all([staff(clinic.id, 'ADMIN'), staff(clinic.id, 'DOCTOR'), staff(clinic.id, 'STAFF')]);
  const dentistry = await prisma.department.create({ data: { clinicId: clinic.id, code: 'DENTAL', name: 'Dentistry' } });
  const patient = await prisma.patient.create({ data: { name: 'Achieng Mary', phone: '0700 000 001', clinicId: clinic.id } });
  const appointment = await prisma.appointment.create({ data: { patientId: patient.id, doctorId: doctor.user.id, clinicId: clinic.id, departmentId: dentistry.id, date: new Date(), time: '09:00' } });
  const consultation = await prisma.consultation.create({ data: { appointmentId: appointment.id, patientId: patient.id, diagnosis: 'Dental caries', symptoms: 'Toothache' } });
  const lab = await prisma.labTest.create({ data: { patientId: patient.id, consultationId: consultation.id, testName: 'Malaria RDT', results: '', orderedBy: 'Dr' } });
  const bill = await app.inject({
    method: 'POST', url: '/invoices', headers: authHeader(desk.token),
    payload: { consultationId: consultation.id, items: [{ kind: 'LAB', description: 'Malaria RDT', unitPrice: 5000, labTestId: lab.id }] },
  });
  expect(bill.statusCode).toBe(200);
  return { clinic, admin, doctor, desk, patient, consultation, invoiceId: bill.json().invoice.id as string };
}

const setPrice = (token: string, clinicId: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'PUT', url: `/clinics/${clinicId}/price-list`, headers: authHeader(token), payload });

describe('the price list', () => {
  it('is set by the administrator, read by everyone who bills, and keeps one price per name', async () => {
    const f = await facility();
    expect((await setPrice(f.admin.token, f.clinic.id, { kind: 'CONSULTATION', name: 'General consultation', price: '10,000' })).statusCode).toBe(200);
    // The same name in other letters changes the price instead of listing it twice.
    const again = await setPrice(f.admin.token, f.clinic.id, { kind: 'CONSULTATION', name: 'general CONSULTATION', price: 12000 });
    expect(again.json().price).toMatchObject({ name: 'general CONSULTATION', price: 12000 });
    expect((await setPrice(f.desk.token, f.clinic.id, { kind: 'LAB', name: 'Malaria RDT', price: 5000 })).statusCode).toBe(403);
    expect((await setPrice(f.admin.token, f.clinic.id, { kind: 'MEDICINE', name: 'Paracetamol', price: 100 })).json().error).toMatch(/priced in stock/);
    expect((await setPrice(f.admin.token, f.clinic.id, { kind: 'LAB', name: 'Malaria RDT', price: 0 })).statusCode).toBe(400);

    const list = await app.inject({ method: 'GET', url: `/clinics/${f.clinic.id}/price-list`, headers: authHeader(f.desk.token) });
    expect(list.json().prices).toEqual([expect.objectContaining({ kind: 'CONSULTATION', price: 12000 })]);

    const other = await seedClinic({ name: 'Elsewhere' });
    expect((await app.inject({ method: 'GET', url: `/clinics/${other.id}/price-list`, headers: authHeader(f.desk.token) })).statusCode).toBe(403);

    const removed = await app.inject({ method: 'DELETE', url: `/clinics/${f.clinic.id}/price-list/${list.json().prices[0].id}`, headers: authHeader(f.admin.token) });
    expect(removed.statusCode).toBe(200);
    expect(await prisma.servicePrice.count()).toBe(0);
  });

  it("suggests the visit's consultation fee, its imaging and the ward procedures, priced from the list", async () => {
    const f = await facility();
    for (const price of [
      { kind: 'CONSULTATION', name: 'General consultation', price: 10000 },
      { kind: 'CONSULTATION', name: 'Dentistry consultation', price: 15000 },
      { kind: 'IMAGING', name: 'Dental X-ray', price: 25000 },
      { kind: 'PROCEDURE', name: 'Incision and drainage', price: 40000 },
    ]) expect((await setPrice(f.admin.token, f.clinic.id, price)).statusCode).toBe(200);

    const xray = await prisma.imagingRequest.create({ data: { clinicId: f.clinic.id, patientId: f.patient.id, consultationId: f.consultation.id, modality: 'XRAY', examination: 'Dental X-ray', requestedBy: 'Dr' } });
    const ward = await prisma.ward.create({ data: { clinicId: f.clinic.id, name: 'Male Ward', type: 'MALE', beds: 4 } });
    const stay = await prisma.admission.create({ data: { clinicId: f.clinic.id, patientId: f.patient.id, wardId: ward.id, reason: 'Abscess', admittedByUserId: f.doctor.user.id } });
    const procedure = await prisma.admissionNote.create({
      data: { admissionId: stay.id, authorUserId: f.doctor.user.id, authorRole: 'DOCTOR', kind: 'PROCEDURE', details: { procedure: 'Incision and drainage', details: 'Pus drained' } },
    });

    const detail = async () => (await app.inject({ method: 'GET', url: `/invoices/detail/${f.invoiceId}`, headers: authHeader(f.desk.token) })).json();
    const suggestions = (await detail()).suggestions;
    // The visit was in Dentistry, so the Dentistry consultation price is offered.
    expect(suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'CONSULTATION', description: 'Dentistry consultation', unitPrice: 15000 }),
      expect.objectContaining({ kind: 'IMAGING', description: 'Dental X-ray', unitPrice: 25000, imagingRequestId: xray.id }),
      expect.objectContaining({ kind: 'PROCEDURE', description: 'Incision and drainage', unitPrice: 40000, admissionNoteId: procedure.id }),
    ]));

    for (const kind of ['CONSULTATION', 'IMAGING', 'PROCEDURE']) {
      const s = suggestions.find((x: any) => x.kind === kind);
      const added = await app.inject({ method: 'POST', url: `/invoices/${f.invoiceId}/items`, headers: authHeader(f.desk.token), payload: s });
      expect(added.statusCode, kind).toBe(200);
    }
    const after = await detail();
    expect(after.invoice.amount).toBe(5000 + 15000 + 25000 + 40000);
    expect(after.suggestions.filter((s: any) => ['CONSULTATION', 'IMAGING', 'PROCEDURE'].includes(s.kind))).toEqual([]);

    // Each examination and procedure is billed once.
    const twice = await app.inject({ method: 'POST', url: `/invoices/${f.invoiceId}/items`, headers: authHeader(f.desk.token), payload: { kind: 'IMAGING', description: 'Dental X-ray', unitPrice: 25000, imagingRequestId: xray.id } });
    expect(twice.statusCode).toBe(409);
    const someoneElse = await prisma.patient.create({ data: { name: 'Other', phone: '0700', clinicId: f.clinic.id } });
    const theirs = await prisma.imagingRequest.create({ data: { clinicId: f.clinic.id, patientId: someoneElse.id, modality: 'ULTRASOUND', examination: 'Pelvic ultrasound', requestedBy: 'Dr' } });
    const wrong = await app.inject({ method: 'POST', url: `/invoices/${f.invoiceId}/items`, headers: authHeader(f.desk.token), payload: { kind: 'IMAGING', description: 'Scan', unitPrice: 1000, imagingRequestId: theirs.id } });
    expect(wrong.json().error).toBe("That imaging request isn't this patient's");
  });

  it('offers a consultation without a listed price at the price last charged', async () => {
    const f = await facility();
    const suggestion = (await app.inject({ method: 'GET', url: `/invoices/detail/${f.invoiceId}`, headers: authHeader(f.desk.token) })).json()
      .suggestions.find((s: any) => s.kind === 'CONSULTATION');
    expect(suggestion).toMatchObject({ description: 'Consultation', unitPrice: null });
  });
});
