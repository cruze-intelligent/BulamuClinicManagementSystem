import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

vi.setConfig({ testTimeout: 60_000 });

const AMOXICILLIN = {
  medication: 'Amoxicillin', strength: '500 mg', form: 'capsule', dosage: '1 capsule', route: 'PO',
  frequency: 'TDS', duration: '5 days', quantity: 15, instructions: 'Take after food',
};

describe('structured diagnoses and prescriptions', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  async function setup(role: 'DOCTOR' | 'ADMIN' = 'DOCTOR') {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role, name: 'Dr Akello' });
    const { token } = await loginAs(app, user.email, password);
    const patient = await prisma.patient.create({
      data: { name: 'Jane Mukasa', phone: '0700', sex: 'FEMALE', dateOfBirth: new Date('2018-03-01'), clinicId: clinic.id },
    });
    const appointment = await prisma.appointment.create({
      data: { patientId: patient.id, doctorId: user.id, clinicId: clinic.id, date: new Date(), time: '09:00' },
    });
    return { clinic, user, token, patient, appointment };
  }

  const record = (token: string, body: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/consultations', headers: authHeader(token), payload: body });

  it('records several ICD-10 coded diagnoses with a primary, certainty and notes, and reads them back in order', async () => {
    const { token, patient, appointment } = await setup();

    const response = await record(token, {
      appointmentId: appointment.id, patientId: patient.id, symptoms: 'Fever, chills, pallor',
      clinicalNotes: 'RDT positive. Review in 3 days.',
      diagnoses: [
        { icd10Code: 'D64.9', description: 'Anaemia, unspecified', type: 'SECONDARY', certainty: 'PROVISIONAL', notes: 'Hb pending' },
        { icd10Code: 'b54', description: 'Malaria, unspecified', type: 'PRIMARY', certainty: 'CONFIRMED' },
      ],
      prescriptions: [AMOXICILLIN],
    });
    expect(response.statusCode).toBe(200);
    const { consultation } = response.json();
    expect(consultation.diagnosis).toBe('Malaria, unspecified');
    expect(consultation.clinicalNotes).toBe('RDT positive. Review in 3 days.');
    expect(consultation.diagnoses.map((d: any) => [d.icd10Code, d.type, d.certainty])).toEqual([
      ['B54', 'PRIMARY', 'CONFIRMED'],
      ['D64.9', 'SECONDARY', 'PROVISIONAL'],
    ]);
    expect(consultation.prescriptions[0]).toMatchObject({ medication: 'Amoxicillin', strength: '500 mg', form: 'capsule', route: 'PO', quantity: 15, instructions: 'Take after food' });

    const history = await app.inject({ method: 'GET', url: `/consultations/patient/${patient.id}`, headers: authHeader(token) });
    expect(history.json().consultations[0].diagnoses).toHaveLength(2);
    expect(history.json().consultations[0].appointment.doctor.name).toBe('Dr Akello');
  });

  it('still accepts the original free-text consultation and stores it as one uncoded primary diagnosis', async () => {
    const { token, patient, appointment } = await setup();

    const response = await record(token, {
      appointmentId: appointment.id, patientId: patient.id, diagnosis: 'Malaria', symptoms: 'Fever',
      prescriptions: [{ medication: 'Coartem', dosage: '4 tablets', frequency: 'twice daily', duration: '3 days' }],
    });
    expect(response.statusCode).toBe(200);
    const { consultation } = response.json();
    expect(consultation.diagnoses).toHaveLength(1);
    expect(consultation.diagnoses[0]).toMatchObject({ description: 'Malaria', icd10Code: null, type: 'PRIMARY', certainty: 'CONFIRMED' });
    expect(consultation.prescriptions[0]).toMatchObject({ medication: 'Coartem', strength: null, quantity: null });
  });

  it('rejects an invalid record with a clear message and stores nothing', async () => {
    const { token, patient, appointment } = await setup();
    const base = { appointmentId: appointment.id, patientId: patient.id, symptoms: 'Fever' };

    const noDiagnosis = await record(token, { ...base, prescriptions: [] });
    expect(noDiagnosis.statusCode).toBe(400);
    expect(noDiagnosis.json().error).toMatch(/diagnosis is required/i);

    const badCode = await record(token, { ...base, diagnoses: [{ description: 'X', icd10Code: 'malaria' }] });
    expect(badCode.statusCode).toBe(400);
    expect(badCode.json().error).toMatch(/ICD-10/);

    const badQuantity = await record(token, { ...base, diagnosis: 'X', prescriptions: [{ ...AMOXICILLIN, quantity: -5 }] });
    expect(badQuantity.statusCode).toBe(400);

    const noSymptoms = await record(token, { appointmentId: appointment.id, patientId: patient.id, diagnosis: 'X' });
    expect(noSymptoms.statusCode).toBe(400);

    expect(await prisma.consultation.count()).toBe(0);
  });

  it('links a prescription to this facility\'s stock item, and drops a link to another facility\'s', async () => {
    const { clinic, token, patient, appointment } = await setup();
    const ownStock = await prisma.medicine.create({ data: { clinicId: clinic.id, name: 'Amoxicillin 500mg', quantity: 100, unit: 'capsules', reorderLevel: 10, price: 200 } });
    const otherClinic = await seedClinic({ name: 'Other' });
    const foreignStock = await prisma.medicine.create({ data: { clinicId: otherClinic.id, name: 'Theirs', quantity: 5, unit: 'tablets', reorderLevel: 1, price: 1 } });

    const response = await record(token, {
      appointmentId: appointment.id, patientId: patient.id, diagnosis: 'Chest infection', symptoms: 'Cough',
      prescriptions: [{ ...AMOXICILLIN, medicineId: ownStock.id }, { ...AMOXICILLIN, medication: 'Other drug', medicineId: foreignStock.id }],
    });
    expect(response.statusCode).toBe(200);
    const rx = response.json().consultation.prescriptions;
    expect(rx.find((p: any) => p.medication === 'Amoxicillin').medicineId).toBe(ownStock.id);
    expect(rx.find((p: any) => p.medication === 'Other drug').medicineId).toBeNull();
  });

  it('ignores fields a prescription has no business setting', async () => {
    const { token, patient, appointment } = await setup();
    const response = await record(token, {
      appointmentId: appointment.id, patientId: patient.id, diagnosis: 'X', symptoms: 'Y',
      prescriptions: [{ ...AMOXICILLIN, id: 'chosen-by-client', consultationId: 'someone-elses', createdAt: '2000-01-01' }],
    });
    expect(response.statusCode).toBe(200);
    const rx = response.json().consultation.prescriptions[0];
    expect(rx.id).not.toBe('chosen-by-client');
    expect(rx.consultationId).toBe(response.json().consultation.id);
  });

  describe('printable prescription', () => {
    it('produces a PDF for a consultation with prescriptions', async () => {
      const { token, patient, appointment } = await setup();
      const created = await record(token, {
        appointmentId: appointment.id, patientId: patient.id, symptoms: 'Cough',
        diagnoses: [{ icd10Code: 'J18.9', description: 'Pneumonia' }], prescriptions: [AMOXICILLIN],
      });

      const pdf = await app.inject({ method: 'GET', url: `/consultations/${created.json().consultation.id}/prescription/pdf`, headers: authHeader(token) });
      expect(pdf.statusCode).toBe(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    });

    it('has nothing to print without prescriptions, and is not available across facilities', async () => {
      const { token, patient, appointment } = await setup();
      const created = await record(token, { appointmentId: appointment.id, patientId: patient.id, diagnosis: 'Sprain', symptoms: 'Pain', prescriptions: [] });
      const consultationId = created.json().consultation.id;

      const none = await app.inject({ method: 'GET', url: `/consultations/${consultationId}/prescription/pdf`, headers: authHeader(token) });
      expect(none.statusCode).toBe(400);

      const withRx = await prisma.consultation.update({ where: { id: consultationId }, data: { prescriptions: { create: { medication: 'Ibuprofen', dosage: '1', frequency: 'TDS', duration: '3 days' } } } });

      const otherClinic = await seedClinic({ name: 'Other' });
      const { user: outsider, password } = await seedUser({ clinicId: otherClinic.id, role: 'DOCTOR' });
      const { token: outsiderToken } = await loginAs(app, outsider.email, password);
      const denied = await app.inject({ method: 'GET', url: `/consultations/${withRx.id}/prescription/pdf`, headers: authHeader(outsiderToken) });
      expect(denied.statusCode).toBe(403);

      const missing = await app.inject({ method: 'GET', url: '/consultations/nope/prescription/pdf', headers: authHeader(token) });
      expect(missing.statusCode).toBe(404);
    });
  });

  describe('offline sync', () => {
    const push = (token: string, clinicId: string, payload: Record<string, unknown>, mutationId = `m-${Math.random()}`) =>
      app.inject({
        method: 'POST', url: '/sync/push', headers: authHeader(token),
        payload: { operations: [{ id: mutationId, entity: 'consultation', clinicId, payload }] },
      });

    it('stores structured diagnoses and prescriptions from a queued consultation', async () => {
      const { clinic, token, patient, appointment } = await setup();
      const updatedAt = new Date().toISOString();

      const response = await push(token, clinic.id, {
        id: 'c-1', appointmentId: appointment.id, patientId: patient.id, symptoms: 'Cough', updatedAt,
        diagnoses: [{ icd10Code: 'J18.9', description: 'Pneumonia', type: 'PRIMARY', certainty: 'CONFIRMED' }],
        prescriptions: [AMOXICILLIN],
      });
      expect(response.json().applied).toHaveLength(1);

      const stored = await prisma.consultation.findUniqueOrThrow({ where: { id: 'c-1' }, include: { diagnoses: true, prescriptions: true } });
      expect(stored.diagnosis).toBe('Pneumonia');
      expect(stored.diagnoses).toHaveLength(1);
      expect(stored.prescriptions[0]).toMatchObject({ strength: '500 mg', route: 'PO', quantity: 15 });
    });

    it('hands the saved consultation back complete, so the device does not lose its prescriptions after syncing', async () => {
      const { clinic, token, patient, appointment } = await setup();

      const response = await push(token, clinic.id, {
        id: 'c-echo', appointmentId: appointment.id, patientId: patient.id, symptoms: 'Cough', updatedAt: new Date().toISOString(),
        diagnoses: [{ icd10Code: 'J18.9', description: 'Pneumonia' }], prescriptions: [AMOXICILLIN],
      });
      const { record } = response.json().applied[0];
      expect(record.diagnoses[0]).toMatchObject({ icd10Code: 'J18.9', type: 'PRIMARY' });
      expect(record.prescriptions[0]).toMatchObject({ medication: 'Amoxicillin', strength: '500 mg', quantity: 15 });
      expect(record.patient.name).toBe('Jane Mukasa');
    });

    it('does not duplicate diagnoses or prescriptions when the same consultation is sent again', async () => {
      const { clinic, token, patient, appointment } = await setup();
      const payload = {
        id: 'c-retry', appointmentId: appointment.id, patientId: patient.id, symptoms: 'Cough', updatedAt: new Date().toISOString(),
        diagnoses: [{ icd10Code: 'J18.9', description: 'Pneumonia' }, { description: 'Dehydration', type: 'SECONDARY' }],
        prescriptions: [AMOXICILLIN, { ...AMOXICILLIN, medication: 'Paracetamol' }],
      };

      await push(token, clinic.id, payload, 'first-attempt');
      await push(token, clinic.id, payload, 'retry-after-timeout');
      await push(token, clinic.id, payload, 'retry-again');

      expect(await prisma.diagnosis.count({ where: { consultationId: 'c-retry' } })).toBe(2);
      expect(await prisma.prescription.count({ where: { consultationId: 'c-retry' } })).toBe(2);
    });

    it('replaces the prescriptions when a newer version of the consultation is sent', async () => {
      const { clinic, token, patient, appointment } = await setup();
      const base = { id: 'c-edit', appointmentId: appointment.id, patientId: patient.id, symptoms: 'Cough', diagnoses: [{ description: 'Pneumonia' }] };

      await push(token, clinic.id, { ...base, updatedAt: '2026-09-25T08:00:00Z', prescriptions: [AMOXICILLIN] });
      await push(token, clinic.id, { ...base, updatedAt: '2026-09-25T09:00:00Z', prescriptions: [{ ...AMOXICILLIN, medication: 'Azithromycin', strength: '250 mg' }] });

      const rx = await prisma.prescription.findMany({ where: { consultationId: 'c-edit' } });
      expect(rx.map((r) => r.medication)).toEqual(['Azithromycin']);
    });

    it('accepts a consultation queued by an older version of the app (plain diagnosis string)', async () => {
      const { clinic, token, patient, appointment } = await setup();

      const response = await push(token, clinic.id, {
        id: 'c-legacy', appointmentId: appointment.id, patientId: patient.id, diagnosis: 'Malaria', symptoms: 'Fever', updatedAt: new Date().toISOString(),
        prescriptions: [{ medication: 'Coartem', dosage: '4 tablets', frequency: 'BD', duration: '3 days' }],
      });
      expect(response.json().applied).toHaveLength(1);

      const stored = await prisma.consultation.findUniqueOrThrow({ where: { id: 'c-legacy' }, include: { diagnoses: true, prescriptions: true } });
      expect(stored.diagnoses.map((d) => [d.description, d.type, d.icd10Code])).toEqual([['Malaria', 'PRIMARY', null]]);
      expect(stored.prescriptions).toHaveLength(1);
    });

    it('does not flatten coded diagnoses when an older client re-sends the same record it only knows as text', async () => {
      const { clinic, token, patient, appointment } = await setup();
      await push(token, clinic.id, {
        id: 'c-keep', appointmentId: appointment.id, patientId: patient.id, symptoms: 'Fever', updatedAt: '2026-09-25T08:00:00Z',
        diagnoses: [{ icd10Code: 'B54', description: 'Malaria' }, { icd10Code: 'D64.9', description: 'Anaemia', type: 'SECONDARY' }],
      });

      await push(token, clinic.id, { id: 'c-keep', appointmentId: appointment.id, patientId: patient.id, symptoms: 'Fever, vomiting', diagnosis: 'Malaria', updatedAt: '2026-09-25T09:00:00Z' });

      const stored = await prisma.consultation.findUniqueOrThrow({ where: { id: 'c-keep' }, include: { diagnoses: true } });
      expect(stored.symptoms).toBe('Fever, vomiting');
      expect(stored.diagnoses.map((d) => d.icd10Code).sort()).toEqual(['B54', 'D64.9']);
    });

    it('rejects a queued consultation with an invalid ICD-10 code and stores nothing', async () => {
      const { clinic, token, patient, appointment } = await setup();
      const response = await push(token, clinic.id, {
        id: 'c-bad', appointmentId: appointment.id, patientId: patient.id, symptoms: 'Fever', updatedAt: new Date().toISOString(),
        diagnoses: [{ icd10Code: 'not-a-code', description: 'Malaria' }],
      });
      expect(response.json().applied).toHaveLength(0);
      expect(await prisma.consultation.count()).toBe(0);
    });

    it('sends diagnoses and full prescriptions to other devices when they pull', async () => {
      const { clinic, token, patient, appointment } = await setup();
      await push(token, clinic.id, {
        id: 'c-pull', appointmentId: appointment.id, patientId: patient.id, symptoms: 'Cough', updatedAt: new Date().toISOString(),
        diagnoses: [{ icd10Code: 'J18.9', description: 'Pneumonia' }], prescriptions: [AMOXICILLIN],
      });

      const pulled = await app.inject({ method: 'GET', url: `/sync/pull?clinicId=${clinic.id}`, headers: authHeader(token) });
      const consultation = pulled.json().consultations.find((c: any) => c.id === 'c-pull');
      expect(consultation.diagnoses[0].icd10Code).toBe('J18.9');
      expect(consultation.prescriptions[0].strength).toBe('500 mg');
    });
  });

  describe('reports', () => {
    async function visit(token: string, clinicId: string, doctorId: string, diagnoses: any[], name: string) {
      const patient = await prisma.patient.create({ data: { name, phone: '0700', clinicId } });
      const appointment = await prisma.appointment.create({ data: { patientId: patient.id, doctorId, clinicId, date: new Date(), time: '09:00' } });
      const response = await record(token, { appointmentId: appointment.id, patientId: patient.id, symptoms: 'x', diagnoses });
      expect(response.statusCode).toBe(200);
    }

    it('counts HMIS 105 cases by ICD-10 code and certainty, not by matching words', async () => {
      const { clinic, user, token } = await setup();
      const now = new Date();

      await visit(token, clinic.id, user.id, [{ icd10Code: 'B54', description: 'Malaria', certainty: 'CONFIRMED' }], 'A');
      await visit(token, clinic.id, user.id, [{ icd10Code: 'B54', description: 'Suspected malaria', certainty: 'PROVISIONAL' }], 'B');
      await visit(token, clinic.id, user.id, [{ icd10Code: 'J06.9', description: 'Viral URTI - not malaria' }], 'C');
      await visit(token, clinic.id, user.id, [{ description: 'Severe malaria' }], 'D');
      await visit(token, clinic.id, user.id, [{ icd10Code: 'I10', description: 'Hypertension' }], 'E');

      const report = await app.inject({ method: 'GET', url: `/reports/hmis-105/${clinic.id}?month=${now.getMonth() + 1}&year=${now.getFullYear()}`, headers: authHeader(token) });
      expect(report.statusCode).toBe(200);
      const cases = Object.fromEntries(report.json().section2_epidemicSurveillance.map((r: any) => [r.condition, r.cases]));
      expect(cases['Confirmed Malaria']).toBe(2); // coded confirmed + uncoded "Severe malaria"
      expect(cases['Suspected Fever / Unconfirmed Malaria']).toBe(1); // provisional malaria
      expect(cases['Severe Acute Respiratory Infections (SARI)']).toBe(1); // J06.9, despite "not malaria" in the wording
      expect(cases['Other General Conditions']).toBe(1);
    });

    it('ranks top diagnoses by code so differently worded entries count as one condition', async () => {
      const { clinic, user, token } = await setup('ADMIN');

      await visit(token, clinic.id, user.id, [{ icd10Code: 'B54', description: 'Malaria' }], 'A');
      await visit(token, clinic.id, user.id, [{ icd10Code: 'B54', description: 'Malaria' }], 'B');
      await visit(token, clinic.id, user.id, [{ icd10Code: 'B54', description: 'malaria (RDT+)' }], 'C');
      await visit(token, clinic.id, user.id, [{ icd10Code: 'J06.9', description: 'URTI' }], 'D');
      // Only the primary counts - a secondary diagnosis is not a second visit.
      await visit(token, clinic.id, user.id, [{ icd10Code: 'J06.9', description: 'URTI' }, { icd10Code: 'B54', description: 'Malaria', type: 'SECONDARY' }], 'E');

      const now = new Date();
      const report = await app.inject({ method: 'GET', url: `/reports/monthly/${clinic.id}?month=${now.getMonth() + 1}&year=${now.getFullYear()}`, headers: authHeader(token) });
      expect(report.statusCode).toBe(200);
      expect(report.json().report.topDiagnoses).toEqual([
        { diagnosis: 'Malaria', icd10Code: 'B54', _count: { diagnosis: 3 } },
        { diagnosis: 'URTI', icd10Code: 'J06.9', _count: { diagnosis: 2 } },
      ]);
    });

    it('exports ICD-10 coded Conditions and MedicationRequests in the FHIR bundle', async () => {
      const { clinic, token, patient, appointment } = await setup();
      await record(token, {
        appointmentId: appointment.id, patientId: patient.id, symptoms: 'Cough',
        diagnoses: [{ icd10Code: 'J18.9', description: 'Pneumonia', certainty: 'PROVISIONAL' }], prescriptions: [AMOXICILLIN],
      });

      const bundle = await app.inject({ method: 'GET', url: `/reports/fhir/patients/${clinic.id}`, headers: authHeader(token) });
      expect(bundle.statusCode).toBe(200);
      const resources = bundle.json().entry.map((e: any) => e.resource);

      const condition = resources.find((r: any) => r.resourceType === 'Condition');
      expect(condition.code.coding[0]).toEqual({ system: 'http://hl7.org/fhir/sid/icd-10', code: 'J18.9', display: 'Pneumonia' });
      expect(condition.verificationStatus.coding[0].code).toBe('provisional');

      const encounter = resources.find((r: any) => r.resourceType === 'Encounter');
      expect(encounter.reasonCode[0].coding[0].code).toBe('J18.9');

      const request = resources.find((r: any) => r.resourceType === 'MedicationRequest');
      expect(request.medicationCodeableConcept.text).toBe('Amoxicillin 500 mg capsule');
      expect(request.dosageInstruction[0].text).toContain('Take 1 capsule by mouth three times daily (TDS) for 5 days');
      expect(request.dispenseRequest.quantity.value).toBe(15);
    });
  });
});

describe('patient portal: diagnoses and prescriptions', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  async function setup() {
    const clinic = await seedClinic();
    const { user: doctor, password } = await seedUser({ clinicId: clinic.id, role: 'DOCTOR' });
    const { token } = await loginAs(app, doctor.email, password);

    const registered = await app.inject({ method: 'POST', url: '/patients', headers: authHeader(token), payload: { name: 'Jane Mukasa', phone: '0756111222', sex: 'FEMALE' } });
    const patientId = registered.json().patient.id as string;

    const created = await app.inject({ method: 'POST', url: `/patients/${patientId}/portal-account`, headers: authHeader(token), payload: { phone: '0756111222', email: 'jane@example.com' } });
    const setPasswordToken = new URL(created.json().devSetPasswordUrl).searchParams.get('token')!;
    await app.inject({ method: 'POST', url: '/patient-auth/set-password', payload: { token: setPasswordToken, password: 'MyNewPassword123!', phone: '0756111222' } });
    const login = await app.inject({ method: 'POST', url: '/patient-auth/login', payload: { identifier: created.json().portableId, password: 'MyNewPassword123!' } });
    const patientToken = login.json().token as string;

    const appointment = await prisma.appointment.create({ data: { patientId, doctorId: doctor.id, clinicId: clinic.id, date: new Date(), time: '09:00' } });
    const consultation = await app.inject({
      method: 'POST', url: '/consultations', headers: authHeader(token),
      payload: {
        appointmentId: appointment.id, patientId, symptoms: 'Cough', clinicalNotes: 'Internal impression - do not share',
        diagnoses: [{ icd10Code: 'J18.9', description: 'Pneumonia' }], prescriptions: [AMOXICILLIN],
      },
    });
    return { clinic, token, patientId, patientToken, consultationId: consultation.json().consultation.id as string };
  }

  it('shows a patient their diagnoses and full prescription details, but not the clinician\'s internal notes', async () => {
    const { patientToken } = await setup();

    const me = await app.inject({ method: 'GET', url: '/patient-portal/me', headers: authHeader(patientToken) });
    const consultation = me.json().records[0].consultations[0];
    expect(consultation.diagnoses[0]).toMatchObject({ icd10Code: 'J18.9', description: 'Pneumonia', type: 'PRIMARY' });
    expect(consultation.prescriptions[0]).toMatchObject({ medication: 'Amoxicillin', strength: '500 mg', route: 'PO', frequency: 'TDS', quantity: 15 });
    expect(JSON.stringify(consultation)).not.toContain('Internal impression');
  });

  it('lets a patient download their own prescription as a PDF, and nobody else\'s', async () => {
    const { patientToken, consultationId, clinic } = await setup();

    const pdf = await app.inject({ method: 'GET', url: `/patient-portal/consultations/${consultationId}/prescription/pdf`, headers: authHeader(patientToken) });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');

    // Another patient, at the same facility, with their own portal account.
    const { user: nurse, password } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const { token: nurseToken } = await loginAs(app, nurse.email, password);
    const other = await app.inject({ method: 'POST', url: '/patients', headers: authHeader(nurseToken), payload: { name: 'Other Person', phone: '0756999888' } });
    const created = await app.inject({ method: 'POST', url: `/patients/${other.json().patient.id}/portal-account`, headers: authHeader(nurseToken), payload: { phone: '0756999888', email: 'other@example.com' } });
    const setToken = new URL(created.json().devSetPasswordUrl).searchParams.get('token')!;
    await app.inject({ method: 'POST', url: '/patient-auth/set-password', payload: { token: setToken, password: 'OtherPassword123!', phone: '0756999888' } });
    const otherLogin = await app.inject({ method: 'POST', url: '/patient-auth/login', payload: { identifier: created.json().portableId, password: 'OtherPassword123!' } });

    const denied = await app.inject({ method: 'GET', url: `/patient-portal/consultations/${consultationId}/prescription/pdf`, headers: authHeader(otherLogin.json().token) });
    expect(denied.statusCode).toBe(404);

    const unauthenticated = await app.inject({ method: 'GET', url: `/patient-portal/consultations/${consultationId}/prescription/pdf` });
    expect(unauthenticated.statusCode).toBe(401);
  });
});
