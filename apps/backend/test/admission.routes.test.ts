import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';
import { normalizeVitals } from '../src/lib/vitals';

vi.setConfig({ testTimeout: 60_000 });

const sendMailMock = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/mailer')>();
  return { ...actual, sendMail: sendMailMock };
});

describe('ward observations', () => {
  it('accepts plausible vitals and rejects obvious slips', () => {
    expect(normalizeVitals({ temperatureC: '38.46', pulse: 110, systolic: 120, diastolic: 80, spo2: 95 })).toEqual({
      ok: true, value: { temperatureC: 38.5, pulse: 110, systolic: 120, diastolic: 80, spo2: 95 },
    });
    expect(normalizeVitals({ temperatureC: 375 })).toMatchObject({ ok: false, error: expect.stringMatching(/Temperature/) });
    expect(normalizeVitals({ systolic: 80, diastolic: 90 })).toMatchObject({ ok: false });
    expect(normalizeVitals({ spo2: '' })).toEqual({ ok: true, value: null });
    expect(normalizeVitals(undefined)).toEqual({ ok: true, value: null });
  });
});

describe('wards and admissions', () => {
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

  async function staff(clinicId: string, role: 'ADMIN' | 'DOCTOR' | 'NURSE' | 'STAFF' | 'PHARMACIST', name?: string) {
    const { user, password } = await seedUser({ clinicId, role, name });
    return { id: user.id, token: (await loginAs(app, user.email, password)).token };
  }

  async function setup() {
    const clinic = await seedClinic({ name: 'Mityana Hospital', facilityType: 'HOSPITAL', phone: '0702000001' });
    const admin = await staff(clinic.id, 'ADMIN');
    const doctor = await staff(clinic.id, 'DOCTOR', 'Dr Namata');
    const nurse = await staff(clinic.id, 'NURSE', 'Nurse Akello');
    const nurse2 = await staff(clinic.id, 'NURSE', 'Nurse Opio');
    const ward = (await app.inject({ method: 'POST', url: '/wards', headers: authHeader(admin.token), payload: { name: 'Female Ward', type: 'FEMALE', beds: 2 } })).json().ward;
    const patient = await prisma.patient.create({ data: { name: 'Sarah Nakato', phone: '0772111222', clinicId: clinic.id, sex: 'FEMALE', allergyStatus: 'NONE_KNOWN' } });
    return { clinic, admin, doctor, nurse, nurse2, ward, patient };
  }

  const admit = (token: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/admissions', headers: authHeader(token), payload });

  it('lets only the facility admin set up wards, and reports occupancy', async () => {
    const { clinic, admin, nurse, ward, patient } = await setup();
    expect(ward).toMatchObject({ name: 'Female Ward', beds: 2, occupied: 0 });
    expect((await app.inject({ method: 'POST', url: '/wards', headers: authHeader(nurse.token), payload: { name: 'X', beds: 3 } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/wards', headers: authHeader(admin.token), payload: { name: 'Female Ward', beds: 3 } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/wards', headers: authHeader(admin.token), payload: { name: 'Bad', beds: 0 } })).statusCode).toBe(400);

    await admit(nurse.token, { patientId: patient.id, wardId: ward.id, bed: 'B1', reason: 'Severe malaria' });
    const wards = (await app.inject({ method: 'GET', url: '/wards', headers: authHeader(nurse.token) })).json().wards;
    expect(wards[0]).toMatchObject({ occupied: 1, beds: 2 });

    // A ward cannot shrink below its patients, nor close with patients on it.
    expect((await app.inject({ method: 'PATCH', url: `/wards/${ward.id}`, headers: authHeader(admin.token), payload: { beds: 0 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: `/wards/${ward.id}`, headers: authHeader(admin.token), payload: { isActive: false } })).statusCode).toBe(409);

    // Another facility's admin cannot touch it.
    const other = await seedClinic({ name: 'Other', phone: '0702000002' });
    const otherAdmin = await staff(other.id, 'ADMIN');
    expect((await app.inject({ method: 'PATCH', url: `/wards/${ward.id}`, headers: authHeader(otherAdmin.token), payload: { beds: 9 } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/wards', headers: authHeader(otherAdmin.token) })).json().wards).toHaveLength(0);
    void clinic;
  });

  it('admits a patient to a bed, tells the nurses and the attending doctor, and audits it', async () => {
    const { doctor, nurse, nurse2, admin, ward, patient } = await setup();
    const res = await admit(nurse.token, { patientId: patient.id, wardId: ward.id, bed: 'B1', reason: 'Severe malaria with anaemia', admissionIcd10Code: 'b50.8', attendingDoctorId: doctor.id });
    expect(res.statusCode).toBe(200);
    const admission = res.json().admission;
    expect(admission).toMatchObject({ status: 'ADMITTED', bed: 'B1', admissionIcd10Code: 'B50.8', attendingDoctor: { name: 'Dr Namata' }, patient: { name: 'Sarah Nakato', allergies: 'No known allergies' } });

    expect((await prisma.notification.findMany({ where: { type: 'PATIENT_ADMITTED' } })).map((n) => n.userId).sort()).toEqual([doctor.id, nurse2.id].sort());
    expect(await prisma.notification.count({ where: { userId: admin.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entity: 'Admission', action: 'CREATE' } })).toBe(1);
  });

  it('refuses a second stay, a taken bed, a full ward, a closed ward and another facility\'s patient', async () => {
    const { clinic, admin, nurse, ward, patient } = await setup();
    await admit(nurse.token, { patientId: patient.id, wardId: ward.id, bed: 'B1', reason: 'X' });
    expect((await admit(nurse.token, { patientId: patient.id, wardId: ward.id, reason: 'Again' })).statusCode).toBe(409);

    const p2 = await prisma.patient.create({ data: { name: 'Two', phone: '0700', clinicId: clinic.id } });
    const p3 = await prisma.patient.create({ data: { name: 'Three', phone: '0700', clinicId: clinic.id } });
    const taken = await admit(nurse.token, { patientId: p2.id, wardId: ward.id, bed: 'B1', reason: 'X' });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error).toMatch(/Bed B1/);
    expect((await admit(nurse.token, { patientId: p2.id, wardId: ward.id, bed: 'B2', reason: 'X' })).statusCode).toBe(200);
    const full = await admit(nurse.token, { patientId: p3.id, wardId: ward.id, reason: 'X' });
    expect(full.statusCode).toBe(409);
    expect(full.json().error).toMatch(/full/);

    const closed = (await app.inject({ method: 'POST', url: '/wards', headers: authHeader(admin.token), payload: { name: 'Old', beds: 4 } })).json().ward;
    await app.inject({ method: 'PATCH', url: `/wards/${closed.id}`, headers: authHeader(admin.token), payload: { isActive: false } });
    expect((await admit(nurse.token, { patientId: p3.id, wardId: closed.id, reason: 'X' })).statusCode).toBe(404);

    const other = await seedClinic({ name: 'Other', phone: '0702000003' });
    const foreign = await prisma.patient.create({ data: { name: 'Foreign', phone: '0700', clinicId: other.id } });
    expect((await admit(nurse.token, { patientId: foreign.id, wardId: ward.id, reason: 'X' })).statusCode).toBe(404);
    expect((await admit(nurse.token, { patientId: p3.id, wardId: ward.id })).statusCode).toBe(400);
  });

  it('records notes and observations, moves the patient between wards, and keeps it all in the chart', async () => {
    const { admin, doctor, nurse, ward, patient } = await setup();
    const id = (await admit(nurse.token, { patientId: patient.id, wardId: ward.id, bed: 'B1', reason: 'X' })).json().admission.id;
    const note = (payload: Record<string, unknown>, token = nurse.token) => app.inject({ method: 'POST', url: `/admissions/${id}/notes`, headers: authHeader(token), payload });

    expect((await note({ kind: 'OBSERVATION', vitals: { temperatureC: 39.2, pulse: 118, spo2: 94 } })).statusCode).toBe(200);
    expect((await note({ kind: 'WARD_ROUND', note: 'Responding to IV artesunate. Continue.' }, doctor.token)).statusCode).toBe(200);
    expect((await note({ kind: 'OBSERVATION', vitals: { temperatureC: 375 } })).statusCode).toBe(400);
    expect((await note({ kind: 'NURSING_NOTE' })).statusCode).toBe(400);

    const hdu = (await app.inject({ method: 'POST', url: '/wards', headers: authHeader(admin.token), payload: { name: 'HDU', type: 'ICU', beds: 1 } })).json().ward;
    const moved = await app.inject({ method: 'POST', url: `/admissions/${id}/transfer`, headers: authHeader(nurse.token), payload: { wardId: hdu.id, bed: 'H1', note: 'Deteriorating' } });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().admission).toMatchObject({ ward: { name: 'HDU' }, bed: 'H1' });

    const chart = (await app.inject({ method: 'GET', url: `/admissions/${id}`, headers: authHeader(doctor.token) })).json().admission;
    expect(chart.notes.map((n: any) => n.kind)).toEqual(['TRANSFER', 'WARD_ROUND', 'OBSERVATION']);
    expect(chart.notes[0].note).toBe('Moved from Female Ward, bed B1 to HDU, bed H1. Deteriorating');
    expect(chart.notes[2]).toMatchObject({ authorName: 'Nurse Akello', vitals: { temperatureC: 39.2, pulse: 118, spo2: 94 } });
  });

  it('discharges (doctors and admins only) with a summary, notes become read-only, and the summary prints', async () => {
    const { admin, doctor, nurse, ward, patient } = await setup();
    const id = (await admit(nurse.token, { patientId: patient.id, wardId: ward.id, reason: 'Severe malaria' })).json().admission.id;
    const discharge = (token: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: `/admissions/${id}/discharge`, headers: authHeader(token), payload });

    expect((await discharge(nurse.token, { outcome: 'RECOVERED', dischargeDiagnosis: 'X', dischargeSummary: 'Y' })).statusCode).toBe(403);
    expect((await discharge(doctor.token, { outcome: 'RECOVERED', dischargeSummary: 'Y' })).statusCode).toBe(400);
    expect((await discharge(doctor.token, { outcome: 'GONE', dischargeDiagnosis: 'X', dischargeSummary: 'Y' })).statusCode).toBe(400);

    const ok = await discharge(doctor.token, {
      outcome: 'RECOVERED', dischargeDiagnosis: 'Severe P. falciparum malaria', dischargeIcd10Code: 'B50.8',
      dischargeSummary: '3 days IV artesunate, then oral ACT.', followUpInstructions: 'Complete Coartem. Review in 1 week.',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().admission).toMatchObject({ status: 'DISCHARGED', outcome: 'RECOVERED', outcomeLabel: 'Discharged - recovered' });
    expect((await prisma.notification.findMany({ where: { type: 'PATIENT_DISCHARGED' } })).map((n) => n.userId)).toContain(admin.id);

    expect((await app.inject({ method: 'POST', url: `/admissions/${id}/notes`, headers: authHeader(nurse.token), payload: { note: 'late' } })).statusCode).toBe(409);
    expect((await discharge(doctor.token, { outcome: 'RECOVERED', dischargeDiagnosis: 'X', dischargeSummary: 'Y' })).statusCode).toBe(409);

    const pdf = await app.inject({ method: 'GET', url: `/admissions/${id}/discharge-summary`, headers: authHeader(nurse.token) });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');

    // The bed is free again.
    expect((await app.inject({ method: 'GET', url: '/wards', headers: authHeader(nurse.token) })).json().wards[0].occupied).toBe(0);
  });

  it('discharges by referral: the referral is created with the patient\'s consent and travels with them', async () => {
    const { doctor, nurse, ward, patient } = await setup();
    const referralHospital = await seedClinic({ name: 'Mulago National Referral', facilityType: 'HOSPITAL', phone: '0702000009' });
    const receiving = await staff(referralHospital.id, 'DOCTOR');
    const id = (await admit(nurse.token, { patientId: patient.id, wardId: ward.id, reason: 'Obstructed labour' })).json().admission.id;

    const noConsent = await app.inject({
      method: 'POST', url: `/admissions/${id}/discharge`, headers: authHeader(doctor.token),
      payload: { outcome: 'REFERRED', dischargeDiagnosis: 'Obstructed labour', dischargeSummary: 'Needs CS', referral: { toClinicId: referralHospital.id, urgency: 'EMERGENCY' } },
    });
    expect(noConsent.statusCode).toBe(400);
    expect((await prisma.admission.findUniqueOrThrow({ where: { id } })).status).toBe('ADMITTED');

    const res = await app.inject({
      method: 'POST', url: `/admissions/${id}/discharge`, headers: authHeader(doctor.token),
      payload: { outcome: 'REFERRED', dischargeDiagnosis: 'Obstructed labour', dischargeSummary: 'Needs CS', referral: { toClinicId: referralHospital.id, urgency: 'EMERGENCY', consentConfirmed: true } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().admission.referral).toMatchObject({ toClinic: { name: 'Mulago National Referral' }, status: 'PENDING' });
    const referral = await prisma.referral.findFirstOrThrow({ where: { patientId: patient.id } });
    expect(referral).toMatchObject({ urgency: 'EMERGENCY', reason: 'Obstructed labour', clinicalSummary: 'Needs CS' });
    expect((await prisma.notification.findMany({ where: { userId: receiving.id } }))[0].title).toBe('EMERGENCY referral received');
  });

  it('keeps one facility\'s inpatients invisible to another', async () => {
    const { nurse, ward, patient } = await setup();
    const id = (await admit(nurse.token, { patientId: patient.id, wardId: ward.id, reason: 'X' })).json().admission.id;
    const other = await seedClinic({ name: 'Other', phone: '0702000004' });
    const outsider = await staff(other.id, 'DOCTOR');
    expect((await app.inject({ method: 'GET', url: `/admissions/${id}`, headers: authHeader(outsider.token) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/admissions', headers: authHeader(outsider.token) })).json().admissions).toHaveLength(0);
    expect((await app.inject({ method: 'POST', url: `/admissions/${id}/notes`, headers: authHeader(outsider.token), payload: { note: 'x' } })).statusCode).toBe(404);

    const pharmacist = await staff(patient.clinicId, 'PHARMACIST');
    expect((await app.inject({ method: 'GET', url: '/admissions', headers: authHeader(pharmacist.token) })).statusCode).toBe(403);
  });

  it('keeps the working diagnosis up to date on ward rounds, each change written in the chart', async () => {
    const { doctor, nurse, ward, patient } = await setup();
    const id = (await admit(nurse.token, { patientId: patient.id, wardId: ward.id, reason: 'Fever and vomiting' })).json().admission.id;
    const update = (token: string, diagnoses: unknown) => app.inject({ method: 'PUT', url: `/admissions/${id}/diagnoses`, headers: authHeader(token), payload: { diagnoses } });

    expect((await update(nurse.token, [{ description: 'Malaria' }])).statusCode).toBe(403);
    expect((await update(doctor.token, [])).statusCode).toBe(400);
    expect((await update(doctor.token, [{ description: 'Malaria', icd10Code: 'not a code' }])).statusCode).toBe(400);

    const first = await update(doctor.token, [{ description: 'Suspected severe malaria', icd10Code: 'B54', type: 'PRIMARY', certainty: 'PROVISIONAL' }]);
    expect(first.statusCode).toBe(200);
    expect(first.json().admission.diagnoses).toMatchObject([{ description: 'Suspected severe malaria', icd10Code: 'B54', type: 'PRIMARY', certainty: 'PROVISIONAL' }]);

    // Next round: confirmed, with a second diagnosis.
    const second = await update(doctor.token, [
      { description: 'Severe P. falciparum malaria', icd10Code: 'B50.8', type: 'PRIMARY', certainty: 'CONFIRMED' },
      { description: 'Anaemia', icd10Code: 'D64.9', type: 'SECONDARY' },
    ]);
    expect(second.json().admission.diagnoses.map((d: any) => d.description)).toEqual(['Severe P. falciparum malaria', 'Anaemia']);

    const chart = (await app.inject({ method: 'GET', url: `/admissions/${id}`, headers: authHeader(nurse.token) })).json().admission;
    const rounds = chart.notes.filter((n: any) => n.kind === 'WARD_ROUND').map((n: any) => [n.note, n.authorName]);
    expect(rounds).toEqual([
      ['Diagnosis updated. Primary: Severe P. falciparum malaria (B50.8). Also: Anaemia (D64.9).', 'Dr Namata'],
      ['Diagnosis updated. Primary: Suspected severe malaria (B54) - suspected.', 'Dr Namata'],
    ]);
    expect(chart.diagnoses).toHaveLength(2);

    await app.inject({ method: 'POST', url: `/admissions/${id}/discharge`, headers: authHeader(doctor.token), payload: { outcome: 'RECOVERED', dischargeDiagnosis: 'Severe P. falciparum malaria', dischargeSummary: 'Recovered.' } });
    expect((await update(doctor.token, [{ description: 'Late change' }])).statusCode).toBe(409);
  });

  it('orders ward-round lab tests directly to the lab and bills the facility price', async () => {
    const { clinic, doctor, nurse, ward, patient } = await setup();
    const admissionId = (await admit(nurse.token, { patientId: patient.id, wardId: ward.id, reason: 'Persistent fever' })).json().admission.id;
    const price = await prisma.servicePrice.create({ data: { clinicId: clinic.id, kind: 'LAB', name: 'Full blood count', price: 18000 } });
    const options = await app.inject({ method: 'GET', url: `/admissions/${admissionId}/lab-test-options`, headers: authHeader(doctor.token) });
    expect(options.json().tests).toContainEqual({ id: price.id, name: price.name, price: price.price });
    expect((await app.inject({ method: 'POST', url: `/admissions/${admissionId}/lab-tests`, headers: authHeader(nurse.token), payload: { servicePriceId: price.id } })).statusCode).toBe(403);

    const requested = await app.inject({ method: 'POST', url: `/admissions/${admissionId}/lab-tests`, headers: authHeader(doctor.token), payload: { servicePriceId: price.id } });
    expect(requested.statusCode).toBe(200);
    expect(requested.json()).toMatchObject({ test: { admissionId, patientId: patient.id, testName: price.name, status: 'PENDING' }, price: price.price });
    const invoiceItem = await prisma.invoiceItem.findUnique({ where: { labTestId: requested.json().test.id } });
    expect(invoiceItem).toMatchObject({ kind: 'LAB', description: price.name, unitPrice: price.price, amount: price.price, quantity: 1 });

    const chart = (await app.inject({ method: 'GET', url: `/admissions/${admissionId}`, headers: authHeader(nurse.token) })).json().admission;
    expect(chart.labTests).toContainEqual(expect.objectContaining({ id: requested.json().test.id, testName: price.name, status: 'PENDING' }));
    expect(chart.notes.some((entry: any) => entry.kind === 'WARD_ROUND' && entry.note.includes(`Lab test requested: ${price.name}`))).toBe(true);
    const worklist = await app.inject({ method: 'GET', url: `/lab/clinic/${clinic.id}`, headers: authHeader(doctor.token) });
    expect(worklist.json().tests.some((test: any) => test.id === requested.json().test.id)).toBe(true);
  });

  it('keeps inpatient medication orders separate from dispensing and records each nursing treatment safely', async () => {
    const { doctor, nurse, nurse2, ward, patient } = await setup();
    const admissionId = (await admit(nurse.token, { patientId: patient.id, wardId: ward.id, reason: 'Severe malaria' })).json().admission.id;
    const orderUrl = `/admissions/${admissionId}/medication-orders`;
    const payload = { medication: 'Artemether', strength: '80 mg/ml', dose: '80 mg', route: 'IM', frequency: 'Every 12 hours', duration: '3 days', instructions: 'Alternate thigh sites' };

    expect((await app.inject({ method: 'POST', url: orderUrl, headers: authHeader(nurse.token), payload })).statusCode).toBe(403);
    const created = await app.inject({ method: 'POST', url: orderUrl, headers: authHeader(doctor.token), payload });
    expect(created.statusCode).toBe(200);
    expect(created.json().order).toMatchObject({ ...payload, status: 'ACTIVE' });
    const orderId = created.json().order.id;
    expect(await prisma.admissionNote.count({ where: { admissionId, kind: 'WARD_ROUND' } })).toBe(1);
    expect((await prisma.notification.findMany({ where: { userId: nurse2.id, type: 'NEW_INPATIENT_MEDICATION_ORDER' } })).length).toBe(1);

    const nursing = await app.inject({ method: 'GET', url: '/nursing/medications', headers: authHeader(nurse.token) });
    expect(nursing.json().orders[0]).toMatchObject({ id: orderId, admission: { id: admissionId, patient: { name: 'Sarah Nakato' } } });
    const administrationUrl = `${orderUrl}/${orderId}/administrations`;
    expect((await app.inject({ method: 'POST', url: administrationUrl, headers: authHeader(nurse.token), payload: { status: 'GIVEN' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: administrationUrl, headers: authHeader(nurse.token), payload: { status: 'WITHHELD' } })).statusCode).toBe(400);
    const given = await app.inject({ method: 'POST', url: administrationUrl, headers: authHeader(nurse.token), payload: { status: 'GIVEN', doseGiven: '80 mg', routeGiven: 'IM', note: 'Left thigh' } });
    expect(given.statusCode).toBe(200);
    expect(given.json().administration).toMatchObject({ status: 'GIVEN', doseGiven: '80 mg', routeGiven: 'IM' });
    const withheld = await app.inject({ method: 'POST', url: administrationUrl, headers: authHeader(nurse.token), payload: { status: 'WITHHELD', note: 'Patient vomiting; clinician notified' } });
    expect(withheld.statusCode).toBe(200);
    expect(await prisma.medicationAdministration.count({ where: { orderId } })).toBe(2);
    expect(await prisma.prescription.count()).toBe(0);

    expect((await app.inject({ method: 'POST', url: `${orderUrl}/${orderId}/stop`, headers: authHeader(nurse.token), payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `${orderUrl}/${orderId}/stop`, headers: authHeader(doctor.token), payload: { reason: 'Course complete' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/nursing/medications', headers: authHeader(nurse.token) })).json().orders).toHaveLength(0);
    expect((await app.inject({ method: 'POST', url: administrationUrl, headers: authHeader(nurse.token), payload: { status: 'GIVEN', doseGiven: '80 mg' } })).statusCode).toBe(409);

    const secondOrder = await app.inject({ method: 'POST', url: orderUrl, headers: authHeader(doctor.token), payload: { medication: 'Paracetamol', dose: '1 g', frequency: 'Every 8 hours' } });
    expect(secondOrder.statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/admissions/${admissionId}/discharge`, headers: authHeader(doctor.token), payload: { outcome: 'RECOVERED', dischargeDiagnosis: 'Malaria', dischargeSummary: 'Recovered.' } })).statusCode).toBe(200);
    expect(await prisma.inpatientMedicationOrder.findFirstOrThrow({ where: { id: secondOrder.json().order.id } })).toMatchObject({ status: 'STOPPED', stopReason: 'Patient discharged' });

    const other = await seedClinic({ name: 'Other facility', phone: '0702000005' });
    const outsider = await staff(other.id, 'NURSE');
    expect((await app.inject({ method: 'GET', url: '/nursing/medications', headers: authHeader(outsider.token) })).json().orders).toHaveLength(0);
  });

  it('deducts and bills the exact linked stock quantity only for a given dose, in the same transaction', async () => {
    const { clinic, admin, doctor, nurse, ward, patient } = await setup();
    const medicine = await prisma.medicine.create({ data: { clinicId: clinic.id, name: 'Ward paracetamol', quantity: 6, unit: 'tablet', reorderLevel: 2, price: 500 } });
    const admissionId = (await admit(nurse.token, { patientId: patient.id, wardId: ward.id, reason: 'Pain' })).json().admission.id;
    const orderResponse = await app.inject({
      method: 'POST', url: `/admissions/${admissionId}/medication-orders`, headers: authHeader(doctor.token),
      payload: { medication: 'Paracetamol', dose: '1 g', frequency: 'Every 8 hours', medicineId: medicine.id },
    });
    expect(orderResponse.statusCode).toBe(200);
    const orderId = orderResponse.json().order.id;
    const url = `/admissions/${admissionId}/medication-orders/${orderId}/administrations`;
    expect((await app.inject({ method: 'POST', url, headers: authHeader(nurse.token), payload: { status: 'GIVEN', doseGiven: '1 g' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url, headers: authHeader(nurse.token), payload: { status: 'WITHHELD', note: 'Patient declined', stockQuantity: 1 } })).statusCode).toBe(400);

    const given = await app.inject({ method: 'POST', url, headers: authHeader(nurse.token), payload: { status: 'GIVEN', doseGiven: '1 g', stockQuantity: 2 } });
    expect(given.statusCode).toBe(200);
    expect(given.json()).toMatchObject({ invoiceId: expect.any(String), administration: { status: 'GIVEN', stockQuantity: 2 } });
    expect(await prisma.medicine.findUniqueOrThrow({ where: { id: medicine.id } })).toMatchObject({ quantity: 4 });
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: given.json().invoiceId }, include: { items: true } });
    expect(invoice).toMatchObject({ patientId: patient.id, clinicId: clinic.id, amount: 1000, status: 'PENDING' });
    expect(invoice.items[0]).toMatchObject({ kind: 'MEDICINE', quantity: 2, unitPrice: 500, amount: 1000, medicineId: medicine.id, admissionId, medicationAdministrationId: given.json().administration.id });
    expect(await prisma.stockMovement.findFirstOrThrow({ where: { invoiceItemId: invoice.items[0].id } })).toMatchObject({ kind: 'ADMINISTERED', change: -2, balanceAfter: 4 });
    expect((await app.inject({ method: 'DELETE', url: `/invoices/${invoice.id}/items/${invoice.items[0].id}`, headers: authHeader(doctor.token) })).statusCode).toBe(409);

    const unavailable = await app.inject({ method: 'POST', url, headers: authHeader(nurse.token), payload: { status: 'GIVEN', doseGiven: '1 g', stockQuantity: 5 } });
    expect(unavailable.statusCode).toBe(409);
    expect(await prisma.medicationAdministration.count({ where: { orderId } })).toBe(1);
    expect(await prisma.invoiceItem.count({ where: { invoiceId: invoice.id } })).toBe(1);
    expect(await prisma.medicine.findUniqueOrThrow({ where: { id: medicine.id } })).toMatchObject({ quantity: 4 });
    expect((await app.inject({ method: 'PATCH', url: `/invoices/${invoice.id}/cancel`, headers: authHeader(admin.token), payload: { restock: true } })).statusCode).toBe(200);
    expect(await prisma.medicine.findUniqueOrThrow({ where: { id: medicine.id } })).toMatchObject({ quantity: 4 });
  });
});
