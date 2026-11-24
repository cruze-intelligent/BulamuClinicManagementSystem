import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';
import { pdfText } from './pdf-text';

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

const push = (token: string, payload: Record<string, unknown>, updatedAt = new Date()) => app.inject({
  method: 'POST', url: '/sync/push', headers: authHeader(token),
  payload: { operations: [{ id: randomUUID(), entity: 'consultation', action: 'upsert', recordId: payload.id, payload: { updatedAt: updatedAt.toISOString(), ...payload }, createdAt: new Date().toISOString(), attempts: 0 }] },
});

async function setup() {
  const clinic = await seedClinic({ name: 'Amolatar Community Medical Centre' });
  const { user: doctor, password } = await seedUser({ clinicId: clinic.id, role: 'DOCTOR', name: 'Okello Isaac' });
  const { token } = await loginAs(app, doctor.email, password);
  const { user: admin, password: adminPassword } = await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
  const { token: adminToken } = await loginAs(app, admin.email, adminPassword);
  const patient = await prisma.patient.create({ data: { name: 'Ogwal Francis', phone: '0772340349', clinicId: clinic.id } });
  const appointment = await prisma.appointment.create({ data: { patientId: patient.id, clinicId: clinic.id, doctorId: doctor.id, date: new Date(), time: '09:00', status: 'SCHEDULED' } });
  return { clinic, doctor, token, adminToken, patient, appointment };
}

const visit = (f: Awaited<ReturnType<typeof setup>>, id: string, extra: Record<string, unknown> = {}) => ({
  id, appointmentId: f.appointment.id, patientId: f.patient.id, symptoms: 'Painful swelling on upper right ear x 3/7',
  diagnoses: [{ description: 'Pre-auricular sinus abscess', type: 'PRIMARY' }],
  prescriptions: [{ medication: 'Cefalexin', strength: '500mg', form: 'Capsule', dosage: '500mg', route: 'PO', frequency: 'TDS', duration: '5 days' }],
  ...extra,
});

describe('procedures in a visit\'s treatment plan', () => {
  it('are saved apart from the drugs, print on the medical form, and are offered on the bill at the price-list price', async () => {
    const f = await setup();
    await prisma.servicePrice.create({ data: { clinicId: f.clinic.id, kind: 'PROCEDURE', name: 'Incision and drainage', price: 30000 } });
    const id = randomUUID();
    const saved = await push(f.token, visit(f, id, {
      procedures: [{ name: 'Incision and drainage', notes: 'Right pre-auricular abscess, pus drained' }, { name: '  ' }, { name: 'Ear syringing' }],
      fee: 10000,
    }));
    expect(saved.json().applied).toHaveLength(1);
    expect(saved.json().applied[0].record.procedures.map((p: any) => [p.name, p.notes])).toEqual([
      ['Incision and drainage', 'Right pre-auricular abscess, pus drained'], ['Ear syringing', null],
    ]);
    // Not in the pharmacist's queue: the prescription has one item, the procedures are their own.
    expect(await prisma.prescription.count({ where: { consultationId: id } })).toBe(1);

    // The medical form: named for what it is, whose it is and when.
    const pdf = await app.inject({ method: 'GET', url: `/consultations/${id}/prescription/pdf`, headers: authHeader(f.token) });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-disposition']).toMatch(/^inline; filename="Medical form - Ogwal Francis - \d{4}-\d{2}-\d{2}\.pdf"/);
    // The title a browser shows on its tab, in place of a random address.
    const raw = pdf.rawPayload.toString('latin1');
    const titleRef = /\/Title (\d+) 0 R/.exec(raw)![1];
    expect(raw).toMatch(new RegExp(`\\n${titleRef} 0 obj\\n\\(Medical form - Ogwal Francis - \\d{1,2} [A-Z][a-z]{2} \\d{4}\\)`));
    expect(raw).toContain('/DisplayDocTitle true');
    const text = pdfText(pdf.rawPayload);
    for (const expected of ['MEDICAL FORM', 'Rx', 'Cefalexin', 'Procedures', 'Incision and drainage', 'Right pre-auricular abscess, pus drained', 'Ear syringing']) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain('PRESCRIPTION');

    // The bill offers each procedure, priced from the price list where it is on it.
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { consultationId: id } });
    const detail = (await app.inject({ method: 'GET', url: `/invoices/detail/${invoice.id}`, headers: authHeader(f.adminToken) })).json();
    const offered = detail.suggestions.filter((s: any) => s.kind === 'PROCEDURE');
    expect(offered.map((s: any) => [s.description, s.unitPrice])).toEqual([['Incision and drainage', 30000], ['Ear syringing', null]]);
    const charged = await app.inject({ method: 'POST', url: `/invoices/${invoice.id}/items`, headers: authHeader(f.adminToken), payload: { ...offered[0], unitPrice: 30000 } });
    expect(charged.statusCode).toBe(200);
    const after = (await app.inject({ method: 'GET', url: `/invoices/detail/${invoice.id}`, headers: authHeader(f.adminToken) })).json();
    expect(after.suggestions.filter((s: any) => s.kind === 'PROCEDURE').map((s: any) => s.description)).toEqual(['Ear syringing']);

    // Saved again with a changed plan: what is listed replaces the rest, but the charged one stays with its charge.
    await push(f.token, visit(f, id, { procedures: [{ name: 'Wound dressing' }] }), new Date(Date.now() + 1000));
    const now = await prisma.visitProcedure.findMany({ where: { consultationId: id }, include: { invoiceItem: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
    expect(now.map((p) => [p.name, !!p.invoiceItem])).toEqual([['Incision and drainage', true], ['Wound dressing', false]]);
  });

  it('prints a medical form for a visit with procedures and no drugs, and refuses a procedure that is too long', async () => {
    const f = await setup();
    const id = randomUUID();
    await push(f.token, visit(f, id, { prescriptions: [], procedures: [{ name: 'Circumcision' }] }));
    const pdf = await app.inject({ method: 'GET', url: `/consultations/${id}/prescription/pdf`, headers: authHeader(f.token) });
    expect(pdf.statusCode).toBe(200);
    const text = pdfText(pdf.rawPayload);
    expect(text).toContain('Circumcision');
    expect(text).not.toMatch(/^Rx$/m);

    const tooLong = await push(f.token, visit(f, randomUUID(), { procedures: [{ name: 'x'.repeat(121) }] }));
    expect(tooLong.json().rejected[0].reason).toMatch(/Procedure 1: the name is too long/);
  });
});
