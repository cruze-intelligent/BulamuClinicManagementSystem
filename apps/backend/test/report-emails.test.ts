import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';

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

  it('a failed email never fails the report', async () => {
    sendMailMock.mockResolvedValue({ sent: false, reason: 'SMTP not configured' });
    const clinic = await seedClinic();
    const admin = await signedIn(clinic.id, 'ADMIN');
    const res = await app.inject({ method: 'GET', url: `/reports/monthly/${clinic.id}/pdf`, headers: authHeader(admin.token) });
    expect(res.statusCode).toBe(200);
  });
});
