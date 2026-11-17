import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

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

async function hospital() {
  const clinic = await seedClinic({ name: 'Amolatar Community Medical Centre' });
  const signIn = async (role: 'ADMIN' | 'DOCTOR' | 'STAFF', name: string) => {
    const { user, password } = await seedUser({ clinicId: clinic.id, role, name });
    return { id: user.id, token: (await loginAs(app, user.email, password)).token };
  };
  const admin = await signIn('ADMIN', 'Okello Administrator');
  const dentist = await signIn('DOCTOR', 'Dr Auma Dentist');
  const desk = await signIn('STAFF', 'Akello Front Desk');
  const patient = await prisma.patient.create({ data: { name: 'Okot John', phone: '0700', clinicId: clinic.id } });
  return { clinic, admin, dentist, desk, patient };
}

const post = (token: string, url: string, payload: object) => app.inject({ method: 'POST', url, headers: authHeader(token), payload });
const patch = (token: string, url: string, payload: object) => app.inject({ method: 'PATCH', url, headers: authHeader(token), payload });
const push = (token: string, operations: object[]) => post(token, '/sync/push', { operations });

describe('units of a facility', () => {
  it('are set up by the administrator from the standard list or by name, and seen by everyone', async () => {
    const { clinic, admin, desk } = await hospital();
    const opd = await post(admin.token, '/departments', { code: 'OPD' });
    expect(opd.statusCode, opd.body).toBe(200);
    expect(opd.json().department).toMatchObject({ code: 'OPD', name: 'General OPD', isActive: true });
    expect((await post(admin.token, '/departments', { code: 'DENTAL' })).statusCode).toBe(200);
    expect((await post(admin.token, '/departments', { name: '  Sickle   Cell Clinic ' })).json().department).toMatchObject({ code: null, name: 'Sickle Cell Clinic' });

    // Once each; not a made-up standard code; only the administrator sets them up.
    expect((await post(admin.token, '/departments', { code: 'DENTAL' })).statusCode).toBe(409);
    expect((await post(admin.token, '/departments', { name: 'Dentistry' })).statusCode).toBe(409);
    expect((await post(admin.token, '/departments', { code: 'ASTROLOGY' })).statusCode).toBe(400);
    expect((await post(admin.token, '/departments', { name: '' })).statusCode).toBe(400);
    expect((await post(desk.token, '/departments', { code: 'EYE' })).statusCode).toBe(403);

    const list = await app.inject({ method: 'GET', url: `/departments?clinicId=${clinic.id}`, headers: authHeader(desk.token) });
    expect(list.json().departments.map((d: any) => d.name)).toEqual(['General OPD', 'Dentistry', 'Sickle Cell Clinic']);
  });

  it('have staff assigned to them, and never a unit of another facility', async () => {
    const { clinic, admin, dentist } = await hospital();
    const dental = (await post(admin.token, '/departments', { code: 'DENTAL' })).json().department;
    const assign = await app.inject({ method: 'PUT', url: `/users/${dentist.id}/departments`, headers: authHeader(admin.token), payload: { departmentIds: [dental.id] } });
    expect(assign.statusCode, assign.body).toBe(200);

    const mine = await app.inject({ method: 'GET', url: `/departments?clinicId=${clinic.id}`, headers: authHeader(dentist.token) });
    expect(mine.json().mine).toEqual([dental.id]);
    expect(mine.json().departments[0]).toMatchObject({ name: 'Dentistry', staff: 1 });
    const staff = await app.inject({ method: 'GET', url: `/users/${clinic.id}`, headers: authHeader(admin.token) });
    expect(staff.json().users.find((u: any) => u.id === dentist.id).departmentIds).toEqual([dental.id]);

    const elsewhere = await seedClinic({ name: 'Lira Regional Referral Hospital' });
    const theirs = await prisma.department.create({ data: { clinicId: elsewhere.id, code: 'EYE', name: 'Eye Clinic' } });
    expect((await app.inject({ method: 'PUT', url: `/users/${dentist.id}/departments`, headers: authHeader(admin.token), payload: { departmentIds: [theirs.id] } })).statusCode).toBe(400);
  });
});

describe('a visit in a unit', () => {
  it('arrives from the device in its unit, moves to another, and keeps the unit closed only once nobody waits there', async () => {
    const { clinic, admin, dentist, desk, patient } = await hospital();
    const opd = (await post(admin.token, '/departments', { code: 'OPD' })).json().department;
    const dental = (await post(admin.token, '/departments', { code: 'DENTAL' })).json().department;
    const elsewhere = await seedClinic({ name: 'Lira Regional Referral Hospital' });
    const theirs = await prisma.department.create({ data: { clinicId: elsewhere.id, code: 'OPD', name: 'General OPD' } });
    const now = new Date().toISOString();
    const visit = (id: string, departmentId: string | null, updatedAt = now) => ({
      id: `m-${id}-${updatedAt}`, entity: 'appointment', clinicId: clinic.id,
      payload: { id, patientId: patient.id, doctorId: dentist.id, clinicId: clinic.id, date: now, time: '09:00', status: 'SCHEDULED', checkedInAt: now, departmentId, updatedAt },
    });

    await push(desk.token, [visit('apt-1', opd.id), visit('apt-2', theirs.id)]);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: 'apt-1' } })).departmentId).toBe(opd.id);
    // A unit of another facility is never taken.
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: 'apt-2' } })).departmentId).toBeNull();

    // Sent to the wrong queue: moved to Dentistry.
    const later = new Date(Date.now() + 1000).toISOString();
    await push(desk.token, [visit('apt-1', dental.id, later)]);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: 'apt-1' } })).departmentId).toBe(dental.id);

    // Every pull brings the units, and the ones this person works in.
    await app.inject({ method: 'PUT', url: `/users/${dentist.id}/departments`, headers: authHeader(admin.token), payload: { departmentIds: [dental.id] } });
    const pulled = (await app.inject({ method: 'GET', url: `/sync/pull?clinicId=${clinic.id}`, headers: authHeader(dentist.token) })).json();
    expect(pulled.departments.map((d: any) => d.name)).toEqual(['General OPD', 'Dentistry']);
    expect(pulled.myDepartmentIds).toEqual([dental.id]);
    expect(pulled.appointments.find((a: any) => a.id === 'apt-1').departmentId).toBe(dental.id);

    // Dentistry cannot close while a patient waits there.
    const refused = await patch(admin.token, `/departments/${dental.id}`, { isActive: false });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatch(/1 patient is waiting in Dentistry/);
    await prisma.appointment.update({ where: { id: 'apt-1' }, data: { status: 'COMPLETED' } });
    expect((await patch(admin.token, `/departments/${dental.id}`, { isActive: false })).statusCode).toBe(200);
    // Opened again, as it was.
    const reopened = await post(admin.token, '/departments', { code: 'DENTAL' });
    expect(reopened.json().department).toMatchObject({ id: dental.id, isActive: true });
  });

  it('is counted for its unit in the monthly report, in the Kampala month it happened', async () => {
    const { clinic, admin, dentist, patient } = await hospital();
    const opd = (await post(admin.token, '/departments', { code: 'OPD' })).json().department;
    const dental = (await post(admin.token, '/departments', { code: 'DENTAL' })).json().department;
    await post(admin.token, '/departments', { code: 'EYE' });

    // 01:30 on 1 November in Kampala is still 31 October in UTC.
    const firstOfNovember = new Date('2026-10-31T22:30:00.000Z');
    const seen = async (id: string, departmentId: string | null, at: Date) => {
      await prisma.appointment.create({ data: { id, patientId: patient.id, doctorId: dentist.id, clinicId: clinic.id, date: at, time: '01:30', status: 'COMPLETED', departmentId } });
      await prisma.consultation.create({ data: { appointmentId: id, patientId: patient.id, diagnosis: 'Dental caries', symptoms: 'Toothache', createdAt: at } });
    };
    await seen('v1', dental.id, firstOfNovember);
    await seen('v2', dental.id, new Date('2026-11-10T08:00:00.000Z'));
    await seen('v3', opd.id, new Date('2026-11-12T08:00:00.000Z'));
    await seen('v4', null, new Date('2026-11-13T08:00:00.000Z'));
    await seen('v-oct', opd.id, new Date('2026-10-31T20:00:00.000Z')); // 23:00 on 31 October in Kampala

    const report = (await app.inject({ method: 'GET', url: `/reports/monthly/${clinic.id}?month=11&year=2026`, headers: authHeader(admin.token) })).json().report;
    expect(report.totalConsultations).toBe(4);
    expect(report.byUnit).toEqual([
      { name: 'General OPD', appointments: 1, visits: 1 },
      { name: 'Dentistry', appointments: 2, visits: 2 },
      { name: 'Eye Clinic (Ophthalmology)', appointments: 0, visits: 0 },
      { name: 'No unit given', appointments: 1, visits: 1 },
    ]);
    const october = (await app.inject({ method: 'GET', url: `/reports/monthly/${clinic.id}?month=10&year=2026`, headers: authHeader(admin.token) })).json().report;
    expect(october.totalConsultations).toBe(1);
  });

  it('can be on a ward that belongs to a unit', async () => {
    const { admin } = await hospital();
    const ortho = (await post(admin.token, '/departments', { code: 'ORTHOPAEDICS' })).json().department;
    const ward = await post(admin.token, '/wards', { name: 'Orthopaedic Ward', type: 'SURGICAL', beds: 12, departmentId: ortho.id });
    expect(ward.statusCode, ward.body).toBe(200);
    expect(ward.json().ward.departmentId).toBe(ortho.id);
    expect((await patch(admin.token, `/wards/${ward.json().ward.id}`, { departmentId: null })).json().ward.departmentId).toBeNull();
    expect((await post(admin.token, '/wards', { name: 'Ward B', beds: 4, departmentId: 'not-a-unit' })).statusCode).toBe(400);
  });
});
