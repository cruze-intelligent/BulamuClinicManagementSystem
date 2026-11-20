import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';
import { pdfText } from './pdf-text';
import { sexAgeText } from '../src/lib/patient-text';

const sendMailMock = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/mailer')>();
  return { ...actual, sendMail: sendMailMock };
});

vi.setConfig({ testTimeout: 60_000 });

let app: FastifyInstance;

beforeEach(async () => {
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue({ sent: true, via: 'relay' });
  await resetDb();
  app = await buildTestApp();
});

afterAll(async () => {
  await app?.close();
});

async function facility(name = 'Amolatar Community Medical Centre', phone = '0772 100 200') {
  const clinic = await seedClinic({ name, phone });
  const signIn = async (role: 'ADMIN' | 'DOCTOR' | 'NURSE' | 'STAFF') => {
    const { user, password } = await seedUser({ clinicId: clinic.id, role, name: role === 'DOCTOR' ? 'Dr Okello Isaac' : `${role} Person` });
    return { id: user.id, token: (await loginAs(app, user.email, password)).token };
  };
  return { clinic, admin: await signIn('ADMIN'), doctor: await signIn('DOCTOR'), desk: await signIn('STAFF') };
}
type Facility = Awaited<ReturnType<typeof facility>>;

const register = async (f: Facility, payload: Record<string, unknown>) => {
  const res = await app.inject({ method: 'POST', url: '/patients', headers: authHeader(f.desk.token), payload: { phone: '0700 000 001', clinicId: f.clinic.id, ...payload } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().patient as { id: string; patientNumber: number; dateOfBirth: string | null; dateOfBirthEstimated: boolean };
};

describe("each facility's Patient IDs", () => {
  it('numbers patients 1, 2, 3 in the order they are registered, separately for each facility', async () => {
    const a = await facility();
    const b = await facility('Kabale Clinic', '0752 000 111');
    expect((await register(a, { name: 'Achieng Mary' })).patientNumber).toBe(1);
    expect((await register(a, { name: 'Okot John' })).patientNumber).toBe(2);
    expect((await register(b, { name: 'Tumusiime Ann' })).patientNumber).toBe(1);
    expect((await register(a, { name: 'Adong Grace' })).patientNumber).toBe(3);
    expect((await prisma.clinic.findUniqueOrThrow({ where: { id: a.clinic.id } })).lastPatientNumber).toBe(3);
  });

  it('gives patients registered offline their number when they reach the server, and never repeats one', async () => {
    const f = await facility();
    await register(f, { name: 'Achieng Mary' });
    const synced = await app.inject({
      method: 'POST', url: '/sync/push', headers: authHeader(f.desk.token),
      payload: { operations: [1, 2, 3].map((i) => ({ id: `mut-${i}`, entity: 'patient', clinicId: f.clinic.id, payload: { id: `offline-${i}`, name: `Offline ${i}`, phone: '0700', clinicId: f.clinic.id } })) },
    });
    expect(synced.statusCode).toBe(200);
    const numbers = (await prisma.patient.findMany({ where: { clinicId: f.clinic.id }, orderBy: { patientNumber: 'asc' } })).map((p) => p.patientNumber);
    expect(numbers).toEqual([1, 2, 3, 4]);
    // An edit synced later keeps the number.
    await app.inject({
      method: 'POST', url: '/sync/push', headers: authHeader(f.desk.token),
      payload: { operations: [{ id: 'mut-9', entity: 'patient', clinicId: f.clinic.id, payload: { id: 'offline-1', name: 'Offline One', phone: '0700', clinicId: f.clinic.id } }] },
    });
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: 'offline-1' } })).patientNumber).toBe(2);
  });

  it('never gives two patients registered at the same moment the same number', async () => {
    const f = await facility();
    const created = await Promise.all(Array.from({ length: 8 }, (_, i) => register(f, { name: `Patient ${i}` })));
    expect(new Set(created.map((p) => p.patientNumber))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8]));
  });
});

describe('age when the date of birth is not known', () => {
  it('keeps a date of birth worked out from an age, marked as estimated, and says so wherever the age is shown', async () => {
    const f = await facility();
    const known = await register(f, { name: 'Achieng Mary', sex: 'FEMALE', dateOfBirth: '1990-03-09' });
    expect(known.dateOfBirthEstimated).toBe(false);

    const estimated = await register(f, { name: 'Okot John', sex: 'MALE', dateOfBirth: '1992-11-17', dateOfBirthEstimated: true });
    expect(estimated.dateOfBirthEstimated).toBe(true);
    const stored = await prisma.patient.findUniqueOrThrow({ where: { id: estimated.id } });
    expect(sexAgeText(stored, new Date('2026-11-17T12:00:00Z'))).toBe('34 years (estimated), Male');

    // Correcting it to a known date clears the mark; clearing the date clears it too.
    const edit = (payload: object) => app.inject({ method: 'PATCH', url: `/patients/${estimated.id}`, headers: authHeader(f.desk.token), payload });
    expect((await edit({ dateOfBirth: '1992-05-01', dateOfBirthEstimated: false })).statusCode).toBe(200);
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: estimated.id } })).dateOfBirthEstimated).toBe(false);
    await edit({ dateOfBirth: '1992-11-17', dateOfBirthEstimated: true });
    await edit({ dateOfBirth: '' });
    expect(await prisma.patient.findUniqueOrThrow({ where: { id: estimated.id } })).toMatchObject({ dateOfBirth: null, dateOfBirthEstimated: false });
    expect((await edit({ dateOfBirth: '1850-01-01' })).json().error).toMatch(/more than 130 years/);
  });

  it('carries the estimate from a device that registered the patient offline', async () => {
    const f = await facility();
    await app.inject({
      method: 'POST', url: '/sync/push', headers: authHeader(f.desk.token),
      payload: { operations: [{ id: 'mut-1', entity: 'patient', clinicId: f.clinic.id, payload: { id: 'offline-age', name: 'Opio Peter', phone: '0700', clinicId: f.clinic.id, dateOfBirth: '1980-06-30', dateOfBirthEstimated: true } }] },
    });
    expect(await prisma.patient.findUniqueOrThrow({ where: { id: 'offline-age' } })).toMatchObject({ dateOfBirthEstimated: true });
  });
});

describe("the facility's motto", () => {
  it('is set and cleared by the facility administrator only, and kept short enough to print', async () => {
    const f = await facility();
    const set = (token: string, motto: unknown) => app.inject({ method: 'PUT', url: `/clinics/${f.clinic.id}/motto`, headers: authHeader(token), payload: { motto } });
    expect((await set(f.doctor.token, 'Ours')).statusCode).toBe(403);
    expect((await set(f.admin.token, 'x'.repeat(81))).json().error).toMatch(/80 characters/);
    const saved = await set(f.admin.token, '  Caring   for our community ');
    expect(saved.json()).toMatchObject({ success: true, motto: 'Caring for our community' });
    expect((await app.inject({ method: 'GET', url: `/clinics/${f.clinic.id}/details`, headers: authHeader(f.desk.token) })).json().facility.motto).toBe('Caring for our community');
    expect((await set(f.admin.token, '')).json().motto).toBeNull();
    expect((await prisma.clinic.findUniqueOrThrow({ where: { id: f.clinic.id } })).motto).toBeNull();
    // Branding is not one of the detail changes Bulamu counts.
    expect(await prisma.facilityDetailChange.count()).toBe(0);
  });
});

describe("the facility's documents", () => {
  it('head the prescription with the facility, its motto and Facility ID once, and name the patient by Patient ID and estimated age', async () => {
    const f = await facility();
    await prisma.clinic.update({ where: { id: f.clinic.id }, data: { motto: 'Caring for our community' } });
    await register(f, { name: 'First Patient' });
    const patient = await register(f, { name: 'Okot John', sex: 'MALE', dateOfBirth: '1992-01-01', dateOfBirthEstimated: true });
    const appointment = await prisma.appointment.create({ data: { patientId: patient.id, doctorId: f.doctor.id, clinicId: f.clinic.id, date: new Date(), time: '09:00' } });
    const visit = await app.inject({
      method: 'POST', url: '/consultations', headers: authHeader(f.doctor.token),
      payload: {
        appointmentId: appointment.id, patientId: patient.id, symptoms: 'Fever', diagnoses: [{ icd10Code: 'B50.9', description: 'Severe malaria' }],
        prescriptions: [{ medication: 'Artesunate', strength: '60 mg', form: 'injection', dosage: '120 mg', route: 'IV', frequency: 'Q12H', duration: '1 day', quantity: 4 }],
      },
    });
    expect(visit.statusCode, visit.body).toBe(200);
    const pdf = await app.inject({ method: 'GET', url: `/consultations/${visit.json().consultation.id}/prescription/pdf`, headers: authHeader(f.doctor.token) });
    expect(pdf.statusCode).toBe(200);
    const text = pdfText(pdf.rawPayload);
    expect(text).toContain('Amolatar Community Medical Centre');
    expect(text).toContain('Caring for our community');
    expect(text.match(new RegExp(f.clinic.facilityCode, 'g'))).toHaveLength(1);
    expect(text).toMatch(/Patient ID\s*\n?00002/);
    expect(text).toMatch(/\(estimated\)/);
    expect(text).toContain('I.V Artesunate 120mg 12hrly x 1 day');
    expect(text).not.toMatch(/\bGive\b/);
    expect(text).toContain('bulamu.site - a product of');
  });
});
