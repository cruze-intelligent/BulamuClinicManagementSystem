import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';
import { pdfText } from './pdf-text';

const sendMailMock = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/mailer')>();
  return { ...actual, sendMail: sendMailMock };
});

vi.setConfig({ testTimeout: 60_000 });

let app: FastifyInstance;

beforeEach(async () => {
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue({ sent: true });
  await resetDb();
  app = await buildTestApp();
});

afterAll(async () => {
  await app?.close();
});

async function ward() {
  const clinic = await seedClinic({ name: 'Amolatar Community Medical Centre', facilityType: 'HEALTH_CENTRE_III', phone: '0772 100 200' });
  const staff = async (role: 'ADMIN' | 'DOCTOR' | 'NURSE', name: string) => {
    const { user, password } = await seedUser({ clinicId: clinic.id, role, name });
    return { id: user.id, token: (await loginAs(app, user.email, password)).token };
  };
  const admin = await staff('ADMIN', 'Okello Isaac');
  const doctor = await staff('DOCTOR', 'Dr Ogwang Peter');
  const nurse = await staff('NURSE', 'Sr Akello Ruth');
  const w = (await app.inject({ method: 'POST', url: '/wards', headers: authHeader(admin.token), payload: { name: 'Maternity Ward', type: 'MATERNITY', beds: 4 } })).json().ward;
  const patient = await prisma.patient.create({ data: { name: 'Apio Sarah', phone: '0772111222', clinicId: clinic.id, sex: 'FEMALE', allergyStatus: 'NONE_KNOWN' } });
  const id = (await app.inject({ method: 'POST', url: '/admissions', headers: authHeader(nurse.token), payload: { patientId: patient.id, wardId: w.id, bed: 'M2', reason: 'Obstructed labour', attendingDoctorId: doctor.id } })).json().admission.id as string;
  return { admin, doctor, nurse, id };
}

const chart = (token: string, id: string, payload: object) => app.inject({ method: 'POST', url: `/admissions/${id}/notes`, headers: authHeader(token), payload });

const OPERATION = {
  operation: 'Emergency caesarean section', indication: 'Obstructed labour', surgeon: 'Dr Ogwang Peter', assistant: 'Sr Akello Ruth',
  anaesthetist: 'Mr Odongo (anaesthetic officer)', anaesthesia: 'Spinal', findings: 'Live male infant, Apgar 8 and 9. Intact uterus.',
  procedure: 'Pfannenstiel incision. Lower segment uterine incision. Baby delivered by vertex. Uterus closed in two layers.',
  bloodLoss: '600 ml', complications: 'None', specimens: 'None', postOpOrders: 'Vital signs half-hourly for 4 hours. IV ceftriaxone 1g OD x 3 days.',
};

describe('procedures and operations on the inpatient chart', () => {
  it('records an operation note in the standard structure, by the operating clinician only', async () => {
    const { doctor, nurse, id } = await ward();
    const refused = await chart(nurse.token, id, { kind: 'OPERATION_NOTE', details: OPERATION });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toMatch(/operating clinician/);

    const missing = await chart(doctor.token, id, { kind: 'OPERATION_NOTE', details: { ...OPERATION, anaesthesia: '' } });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error).toBe('Anaesthesia is needed');

    const saved = await chart(doctor.token, id, { kind: 'OPERATION_NOTE', details: { ...OPERATION, specimens: '  ' } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().note).toMatchObject({ kind: 'OPERATION_NOTE', authorName: 'Dr Ogwang Peter' });
    expect(saved.json().note.details).toMatchObject({ operation: 'Emergency caesarean section', anaesthesia: 'Spinal', bloodLoss: '600 ml' });
    expect(saved.json().note.details).not.toHaveProperty('specimens');
  });

  it('lets nurses and clinicians record procedures, and nurses their interventions', async () => {
    const { nurse, id } = await ward();
    const procedure = await chart(nurse.token, id, { kind: 'PROCEDURE', details: { procedure: 'Urethral catheterisation', indication: 'Urinary retention', details: 'Foley 16Fr passed aseptically, 400 ml clear urine drained.' } });
    expect(procedure.statusCode).toBe(200);
    expect((await chart(nurse.token, id, { kind: 'PROCEDURE', details: { procedure: 'Wound dressing' } })).json().error).toBe('What was done and found is needed');
    expect((await chart(nurse.token, id, { kind: 'NURSING_NOTE', note: 'Bed bath given, repositioned 2-hourly.' })).statusCode).toBe(200);

    const read = (await app.inject({ method: 'GET', url: `/admissions/${id}`, headers: authHeader(nurse.token) })).json().admission;
    expect(read.notes.map((n: any) => n.kind)).toEqual(['NURSING_NOTE', 'PROCEDURE']);
    expect(read.notes[1].details.procedure).toBe('Urethral catheterisation');
  });

  it('carries the procedures and operations onto the discharge summary', async () => {
    const { doctor, nurse, id } = await ward();
    await chart(doctor.token, id, { kind: 'OPERATION_NOTE', details: OPERATION });
    await chart(nurse.token, id, { kind: 'PROCEDURE', details: { procedure: 'Urethral catheterisation', details: 'Catheter removed day 2, voiding well.' } });
    const discharged = await app.inject({
      method: 'POST', url: `/admissions/${id}/discharge`, headers: authHeader(doctor.token),
      payload: { outcome: 'RECOVERED', dischargeDiagnosis: 'Obstructed labour, delivered by caesarean section', dischargeSummary: 'Uneventful recovery.', followUpInstructions: 'Review in 1 week for wound check.' },
    });
    expect(discharged.statusCode).toBe(200);
    const pdf = await app.inject({ method: 'GET', url: `/admissions/${id}/discharge-summary`, headers: authHeader(nurse.token) });
    expect(pdf.statusCode).toBe(200);
    const text = pdfText(pdf.rawPayload);
    expect(text).toContain('Procedures and operations');
    expect(text).toContain('Operation: Emergency caesarean section (Dr Ogwang Peter, spinal)');
    expect(text).toContain('Estimated blood loss: 600 ml');
    expect(text).toContain('Procedure: Urethral catheterisation');
    expect(text.indexOf('Operation: Emergency')).toBeLessThan(text.indexOf('Procedure: Urethral'));
  });
});
