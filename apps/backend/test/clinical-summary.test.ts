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

async function facility(name = 'Amolatar Community Medical Centre') {
  const clinic = await seedClinic({ name, phone: name.length % 2 ? '0772 100 200' : '0772 300 400' });
  const signIn = async (role: 'ADMIN' | 'DOCTOR' | 'NURSE' | 'STAFF' | 'PHARMACIST', person: string) => {
    const { user, password } = await seedUser({ clinicId: clinic.id, role, name: person });
    return { id: user.id, token: (await loginAs(app, user.email, password)).token };
  };
  return {
    clinic,
    admin: await signIn('ADMIN', 'Okello Isaac'),
    doctor: await signIn('DOCTOR', 'Dr Ogwang Peter'),
    nurse: await signIn('NURSE', 'Sr Akello Ruth'),
    desk: await signIn('STAFF', 'Front Desk'),
    pharmacist: await signIn('PHARMACIST', 'Pharmacist'),
  };
}

describe("a patient's clinical summary", () => {
  it('brings together each visit - history, vitals, examination, diagnosis, lab results, treatment - and the ward stays', async () => {
    const f = await facility();
    const patient = await prisma.patient.create({ data: { name: 'Apio Sarah', phone: '0772111222', clinicId: f.clinic.id, sex: 'FEMALE', dateOfBirth: new Date('1996-01-01'), dateOfBirthEstimated: true, allergyStatus: 'NONE_KNOWN' } });
    const appointment = await prisma.appointment.create({ data: { patientId: patient.id, doctorId: f.doctor.id, clinicId: f.clinic.id, date: new Date(), time: '09:00' } });
    const visit = await app.inject({
      method: 'POST', url: '/consultations', headers: authHeader(f.doctor.token),
      payload: {
        appointmentId: appointment.id, patientId: patient.id, symptoms: 'Fever for 3 days',
        history: 'Fever with chills, worse at night.', examination: 'Febrile, mild pallor. Chest clear.',
        vitals: { temperatureC: 38.6, pulse: 104, systolic: 118, diastolic: 76 },
        diagnoses: [{ icd10Code: 'B54', description: 'Malaria' }],
        clinicalNotes: 'Review in 3 days if the fever persists.',
        prescriptions: [{ medication: 'Artemether/Lumefantrine', strength: '20/120 mg', form: 'tablet', dosage: '4 tablets', route: 'PO', frequency: 'BD', duration: '3 days', quantity: 24, instructions: 'Take with food' }],
      },
    });
    expect(visit.statusCode, visit.body).toBe(200);
    const consultationId = visit.json().consultation.id;
    await prisma.labTest.create({ data: { patientId: patient.id, consultationId, testName: 'Malaria RDT', results: 'Positive (P. falciparum)', status: 'COMPLETED', orderedBy: 'Dr Ogwang Peter', completedAt: new Date(), verifiedAt: new Date() } });
    await prisma.labTest.create({ data: { patientId: patient.id, consultationId, testName: 'Complete blood count', results: '', status: 'PENDING', orderedBy: 'Dr Ogwang Peter' } });
    const ward = (await app.inject({ method: 'POST', url: '/wards', headers: authHeader(f.admin.token), payload: { name: 'Female Ward', beds: 2 } })).json().ward;
    const admission = (await app.inject({ method: 'POST', url: '/admissions', headers: authHeader(f.nurse.token), payload: { patientId: patient.id, wardId: ward.id, reason: 'Severe malaria' } })).json().admission;
    await app.inject({ method: 'POST', url: `/admissions/${admission.id}/notes`, headers: authHeader(f.nurse.token), payload: { kind: 'PROCEDURE', details: { procedure: 'IV cannulation', details: '20G cannula, left forearm, first attempt.' } } });

    const res = await app.inject({ method: 'GET', url: `/patients/${patient.id}/clinical-summary`, headers: authHeader(f.doctor.token) });
    expect(res.statusCode).toBe(200);
    const { summary } = res.json();
    expect(summary.patient).toMatchObject({ name: 'Apio Sarah', patientId: '00001', allergies: 'No known allergies' });
    expect(summary.patient.sexAge).toMatch(/years \(estimated\), Female/);
    expect(summary.visits).toHaveLength(1);
    expect(summary.visits[0]).toMatchObject({
      clinician: 'Dr Ogwang Peter', complaints: 'Fever for 3 days', history: 'Fever with chills, worse at night.',
      vitals: 'T 38.6°C · P 104 · BP 118/76', examination: 'Febrile, mild pallor. Chest clear.', diagnoses: ['Malaria (B54)'],
      treatment: ['P.O Artemether/Lumefantrine 20/120mg 4 tablets BD x 3 days - Take with food'], plan: 'Review in 3 days if the fever persists.',
    });
    expect(summary.visits[0].labs).toEqual([
      expect.objectContaining({ name: 'Malaria RDT', status: 'Verified', result: 'Positive (P. falciparum)' }),
      expect.objectContaining({ name: 'Complete blood count', status: 'Requested - no result yet', result: null }),
    ]);
    expect(summary.stays[0]).toMatchObject({ ward: 'Female Ward', reason: 'Severe malaria', procedures: [expect.objectContaining({ title: 'Procedure: IV cannulation' })] });
    expect(await prisma.auditLog.count({ where: { entity: 'ClinicalSummary', recordId: patient.id } })).toBe(1);

    const pdf = await app.inject({ method: 'GET', url: `/patients/${patient.id}/clinical-summary/pdf`, headers: authHeader(f.nurse.token) });
    expect(pdf.statusCode).toBe(200);
    const text = pdfText(pdf.rawPayload);
    for (const line of ['CLINICAL SUMMARY', 'Amolatar Community Medical Centre', 'Apio Sarah', '00001', 'History', 'Fever with chills', 'Vital signs', 'Examination', 'Malaria RDT: Positive (P. falciparum)', 'Complete blood count: Requested - no result yet', 'P.O Artemether/Lumefantrine', 'Admission - Female Ward', 'IV cannulation']) {
      expect(text, line).toContain(line);
    }
  });

  it('is for clinical staff only, and only for their own patients', async () => {
    const f = await facility();
    const other = await facility('Kabale Clinic');
    const patient = await prisma.patient.create({ data: { name: 'Apio Sarah', phone: '0700', clinicId: f.clinic.id } });
    const get = (token: string) => app.inject({ method: 'GET', url: `/patients/${patient.id}/clinical-summary`, headers: authHeader(token) });
    expect((await get(f.desk.token)).statusCode).toBe(403);
    expect((await get(f.pharmacist.token)).statusCode).toBe(403);
    expect((await get(other.doctor.token)).statusCode).toBe(404);
    const empty = await get(f.nurse.token);
    expect(empty.json().summary).toMatchObject({ visits: [], stays: [], otherLabs: [] });
  });
});
