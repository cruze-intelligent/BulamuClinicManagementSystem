import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

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

async function signedIn(clinicId: string, role: 'ADMIN' | 'SUPER_ADMIN') {
  const { user, password } = await seedUser({ clinicId, role });
  return { user, token: (await loginAs(app, user.email, password)).token };
}

/** The email that carried a copy of the report to this person, if any. */
const copyTo = (email: string) => sendMailMock.mock.calls.map(([m]) => m).find((m) => m.to === email && m.subject.startsWith('[Bulamu]') && m.attachments?.length);

describe('every report is also emailed to whoever generated it', () => {
  it("the facility's monthly report, as a PDF", async () => {
    const clinic = await seedClinic({ name: 'Amolatar Community Medical Centre' });
    const admin = await signedIn(clinic.id, 'ADMIN');
    const res = await app.inject({ method: 'GET', url: `/reports/monthly/${clinic.id}/pdf?month=11&year=2026`, headers: authHeader(admin.token) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['x-report-emailed-to']).toBe(admin.user.email);
    const mail = copyTo(admin.user.email);
    expect(mail.subject).toBe('[Bulamu] Monthly report - Amolatar Community Medical Centre, November 2026');
    expect(mail.attachments[0]).toMatchObject({ filename: 'monthly-report-2026-11.pdf', contentType: 'application/pdf' });
    expect(Buffer.from(mail.attachments[0].content).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('the financial report and the platform reports - and not when asked not to', async () => {
    const clinic = await seedClinic();
    const admin = await signedIn(clinic.id, 'ADMIN');
    const csv = await app.inject({ method: 'GET', url: `/finances/${clinic.id}/report?format=csv&from=2026-11-01&to=2026-11-17`, headers: authHeader(admin.token) });
    expect(csv.statusCode).toBe(200);
    expect(copyTo(admin.user.email).attachments[0].contentType).toBe('text/csv');

    const hq = await seedClinic({ name: 'Bulamu HQ' });
    const operator = await signedIn(hq.id, 'SUPER_ADMIN');
    const platform = await app.inject({ method: 'GET', url: '/super-admin/analytics/report.pdf?days=30', headers: authHeader(operator.token) });
    expect(platform.statusCode).toBe(200);
    expect(platform.headers['x-report-emailed-to']).toBe(operator.user.email);
    expect(copyTo(operator.user.email).subject).toBe('[Bulamu] Bulamu platform report - last 30 days');

    const facility = await app.inject({ method: 'GET', url: `/clinics/${clinic.id}/export?format=pdf`, headers: authHeader(operator.token) });
    expect(facility.statusCode).toBe(200);
    expect(facility.headers['content-type']).toBe('application/pdf');

    sendMailMock.mockClear();
    const quiet = await app.inject({ method: 'GET', url: '/super-admin/analytics/export?dataset=facilities&email=0', headers: authHeader(operator.token) });
    expect(quiet.statusCode).toBe(200);
    expect(quiet.headers['x-report-emailed-to']).toBeUndefined();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('produces a calendar-year report for the selected year and emails a named copy', async () => {
    const hq = await seedClinic({ name: 'Bulamu HQ' });
    const operator = await signedIn(hq.id, 'SUPER_ADMIN');
    const res = await app.inject({ method: 'GET', url: '/super-admin/analytics/report.pdf?year=2025', headers: authHeader(operator.token) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('bulamu-annual-system-report-2025.pdf');
    expect(res.headers['x-report-emailed-to']).toBe(operator.user.email);
    expect(copyTo(operator.user.email).subject).toBe('[Bulamu] Annual system performance report - 2025');
  });

  it('lists and manually sends the four facility reminders only to active approved facility admins', async () => {
    const hq = await seedClinic({ name: 'Bulamu HQ' });
    const operator = await signedIn(hq.id, 'SUPER_ADMIN');
    const facility = await seedClinic({ name: 'Quiet Facility' });
    const admin = await signedIn(facility.id, 'ADMIN');
    await seedUser({ clinicId: facility.id, role: 'NURSE' });
    await prisma.user.update({ where: { id: admin.user.id }, data: { lastSeenAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) } });

    const list = await app.inject({ method: 'GET', url: '/super-admin/facility-reminders', headers: authHeader(operator.token) });
    expect(list.statusCode).toBe(200);
    expect(list.json().facilities).toEqual([expect.objectContaining({ id: facility.id, idleDays: expect.any(Number), admin: { name: admin.user.name, email: admin.user.email } })]);

    const result = await app.inject({ method: 'POST', url: `/super-admin/facility-reminders/${facility.id}`, headers: authHeader(operator.token), payload: { kind: 'RETENTION' } });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ success: true, sent: true, recipient: admin.user.email });
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: admin.user.email,
      subject: expect.stringContaining('keeps and protects your facility records'),
      html: expect.stringContaining('does not delete'),
    }));
    expect(await prisma.auditLog.count({ where: { clinicId: facility.id, entity: 'FacilityReminder', action: 'CREATE' } })).toBe(1);

    const samples = await app.inject({ method: 'POST', url: '/super-admin/system/sample-emails', headers: authHeader(operator.token) });
    expect(samples.statusCode).toBe(200);
    expect(samples.json().total).toBeGreaterThanOrEqual(4);
    expect(sendMailMock.mock.calls.map(([mail]) => mail.subject)).toEqual(expect.arrayContaining([
      expect.stringContaining('Can we help your team get more from Bulamu?'),
      expect.stringContaining('More ways Bulamu can support your facility'),
      expect.stringContaining('A practical Bulamu setup check-in for your team'),
      expect.stringContaining('How Bulamu keeps and protects your facility records'),
    ]));
  });

  it('rejects invalid annual report years rather than silently returning a short report', async () => {
    const hq = await seedClinic({ name: 'Bulamu HQ' });
    const operator = await signedIn(hq.id, 'SUPER_ADMIN');
    const res = await app.inject({ method: 'GET', url: '/super-admin/analytics/report.pdf?year=2099', headers: authHeader(operator.token) });
    expect(res.statusCode).toBe(400);
  });

  it('a failed email never fails the report', async () => {
    sendMailMock.mockResolvedValue({ sent: false, reason: 'SMTP not configured' });
    const clinic = await seedClinic();
    const admin = await signedIn(clinic.id, 'ADMIN');
    const res = await app.inject({ method: 'GET', url: `/reports/monthly/${clinic.id}/pdf`, headers: authHeader(admin.token) });
    expect(res.statusCode).toBe(200);
  });
});
