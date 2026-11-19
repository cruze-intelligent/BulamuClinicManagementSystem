import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';
import { ageGroupOf, parseActivityQuery, periodKey, periodsBetween } from '../src/lib/activity-report';

const sendMailMock = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/mailer')>();
  return { ...actual, sendMail: sendMailMock };
});

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp();
});
afterAll(async () => {
  await app?.close();
});
beforeEach(async () => {
  await resetDb();
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue({ sent: true, via: 'relay' });
});

/** A moment on a Kampala day, at a Kampala hour. */
const at = (day: string, hour = 10) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00+03:00`);

describe('periods and age groups', () => {
  it('puts a moment in its Kampala day, its Monday-to-Sunday week and its month', () => {
    // 23:30 on Sunday 16 November in Kampala is still Sunday there, though Monday has begun nowhere else.
    expect(periodKey(at('2026-11-16', 23), 'day')).toBe('2026-11-16');
    expect(periodKey(new Date('2026-11-16T21:30:00Z'), 'day')).toBe('2026-11-17');
    expect(periodKey(at('2026-11-16'), 'week')).toBe('2026-11-16');
    expect(periodKey(at('2026-11-22'), 'week')).toBe('2026-11-16');
    expect(periodKey(at('2026-11-23'), 'week')).toBe('2026-11-23');
    expect(periodKey(at('2026-11-30'), 'month')).toBe('2026-11');
    expect(periodsBetween('2026-11-17', '2026-11-19', 'day').map((p) => p.short)).toEqual(['Tue 17', 'Wed 18', 'Thu 19']);
    expect(periodsBetween('2026-11-18', '2026-11-30', 'week').map((p) => p.key)).toEqual(['2026-11-16', '2026-11-23', '2026-11-30']);
    expect(periodsBetween('2026-10-15', '2026-12-01', 'month').map((p) => p.label)).toEqual(['October 2026', 'November 2026', 'December 2026']);
  });

  it('gives the age group at the time of the visit', () => {
    expect(ageGroupOf(new Date('2021-11-20'), at('2026-11-19'))).toBe('under-5');
    expect(ageGroupOf(new Date('2021-11-19'), at('2026-11-19'))).toBe('5-9');
    expect(ageGroupOf(new Date('1966-01-01'), at('2026-11-19'))).toBe('60-plus');
    expect(ageGroupOf(null, at('2026-11-19'))).toBe('unknown');
  });

  it('defaults to the last 7 days by day, and keeps a day-by-day report to two months', () => {
    expect(parseActivityQuery({}, '2026-11-19')).toEqual({ from: '2026-11-13', to: '2026-11-19', period: 'day', sex: null, ageGroup: null });
    expect(parseActivityQuery({ from: '2026-01-01', to: '2026-11-19', period: 'day' })).toHaveProperty('error');
    expect(parseActivityQuery({ from: '2026-11-19', to: '2026-11-01' })).toHaveProperty('error');
    expect(parseActivityQuery({ period: 'week', sex: 'FEMALE', ageGroup: '20-59' }, '2026-11-19')).toMatchObject({ from: '2026-09-28', sex: 'FEMALE', ageGroup: '20-59' });
  });
});

describe('the daily and weekly report', () => {
  it('counts outpatients, inpatients and each lab test by day - for everyone or one sex - and emails the PDF', async () => {
    const clinic = await seedClinic({ name: 'Amolatar Community Medical Centre' });
    const { user: admin, password } = await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
    const { token } = await loginAs(app, admin.email, password);
    const mary = await prisma.patient.create({ data: { name: 'Achieng Mary', phone: '0700', clinicId: clinic.id, sex: 'FEMALE', dateOfBirth: new Date('1990-05-01'), createdAt: at('2026-11-17') } });
    const isaac = await prisma.patient.create({ data: { name: 'Okello Isaac', phone: '0701', clinicId: clinic.id, sex: 'MALE', dateOfBirth: new Date('2023-02-01'), createdAt: at('2026-11-01') } });
    const visit = async (patientId: string, day: string) => {
      const appointment = await prisma.appointment.create({ data: { patientId, clinicId: clinic.id, doctorId: admin.id, date: at(day), time: '10:00', status: 'COMPLETED' } });
      return prisma.consultation.create({ data: { appointmentId: appointment.id, patientId, diagnosis: 'Malaria', symptoms: 'Fever', createdAt: at(day) } });
    };
    const first = await visit(mary.id, '2026-11-17');
    await visit(isaac.id, '2026-11-18');
    for (const [patientId, testName, day] of [[mary.id, 'Complete blood count (CBC)', '2026-11-17'], [isaac.id, 'Complete blood count (CBC)', '2026-11-18'], [isaac.id, 'Malaria RDT', '2026-11-18']]) {
      await prisma.labTest.create({ data: { patientId, consultationId: patientId === mary.id ? first.id : null, testName, results: '', orderedBy: 'Dr', createdAt: at(day) } });
    }
    await prisma.labTest.create({ data: { patientId: mary.id, testName: 'Widal test', results: '', orderedBy: 'Dr', status: 'CANCELLED', createdAt: at('2026-11-17') } });
    const ward = await prisma.ward.create({ data: { clinicId: clinic.id, name: 'Female ward', beds: 10 } });
    await prisma.admission.create({ data: { clinicId: clinic.id, patientId: mary.id, wardId: ward.id, reason: 'Severe malaria', admittedByUserId: admin.id, admittedAt: at('2026-11-17', 12), dischargedAt: at('2026-11-18', 9), status: 'DISCHARGED' } });

    const res = await app.inject({ method: 'GET', url: `/reports/activity/${clinic.id}?from=2026-11-17&to=2026-11-19&period=day`, headers: authHeader(token) });
    expect(res.statusCode).toBe(200);
    const report = res.json().report;
    expect(report.periods.map((p: any) => [p.key, p.outpatients, p.newPatients, p.admitted, p.discharged, p.inWard])).toEqual([
      ['2026-11-17', 1, 1, 1, 0, 1],
      ['2026-11-18', 1, 0, 0, 1, 1],
      ['2026-11-19', 0, 0, 0, 0, 0],
    ]);
    expect(report.totals).toMatchObject({ outpatients: 2, patientsSeen: 2, admitted: 1, inWard: 1, labTests: 3 });
    expect(report.labTests).toEqual([
      { name: 'Complete blood count (CBC)', counts: [1, 1, 0], total: 2 },
      { name: 'Malaria RDT', counts: [0, 1, 0], total: 1 },
    ]);
    expect(report.outpatientsByAgeAndSex.find((r: any) => r.group === 'Under 5 years')).toMatchObject({ male: 1, total: 1 });

    const women = (await app.inject({ method: 'GET', url: `/reports/activity/${clinic.id}?from=2026-11-17&to=2026-11-19&sex=FEMALE`, headers: authHeader(token) })).json().report;
    expect(women.totals).toMatchObject({ outpatients: 1, labTests: 1, admitted: 1 });
    const underFive = (await app.inject({ method: 'GET', url: `/reports/activity/${clinic.id}?from=2026-11-17&to=2026-11-19&ageGroup=under-5`, headers: authHeader(token) })).json().report;
    expect(underFive.labTests.map((t: any) => t.name)).toEqual(['Complete blood count (CBC)', 'Malaria RDT']);

    const weekly = (await app.inject({ method: 'GET', url: `/reports/activity/${clinic.id}?from=2026-11-01&to=2026-11-30&period=week`, headers: authHeader(token) })).json().report;
    expect(weekly.periods.find((p: any) => p.key === '2026-11-16')).toMatchObject({ outpatients: 2, newPatients: 1 });

    const pdf = await app.inject({ method: 'GET', url: `/reports/activity/${clinic.id}/pdf?from=2026-11-17&to=2026-11-19&period=day`, headers: authHeader(token) });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['x-report-emailed-to']).toBe(admin.email);
    const mail = sendMailMock.mock.calls.map(([m]) => m).find((m) => m.to === admin.email && m.attachments?.length);
    expect(mail.subject).toBe('[Bulamu] Daily report - Amolatar Community Medical Centre, 17 Nov 2026 to 19 Nov 2026');
    expect(mail.attachments[0].filename).toBe('daily-report-2026-11-17-to-2026-11-19.pdf');
  });

  it('is for the administrator and doctors', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'PHARMACIST' });
    const { token } = await loginAs(app, user.email, password);
    const res = await app.inject({ method: 'GET', url: `/reports/activity/${clinic.id}`, headers: authHeader(token) });
    expect(res.statusCode).toBe(403);
  });
});
