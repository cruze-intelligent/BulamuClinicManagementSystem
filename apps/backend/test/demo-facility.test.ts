import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';
import { notifyStaff } from '../src/lib/notifications';

const sendMailMock = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/mailer')>();
  return { ...actual, sendMail: sendMailMock };
});

describe('the demo facility', () => {
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

  async function operator() {
    const hq = await seedClinic({ name: 'Bulamu HQ' });
    const { user, password } = await seedUser({ clinicId: hq.id, role: 'SUPER_ADMIN' });
    return (await loginAs(app, user.email, password)).token;
  }
  const create = (token: string, email = 'admin@scholara.site') =>
    app.inject({ method: 'POST', url: '/super-admin/system/demo-facility', headers: authHeader(token), payload: { email } });

  it('creates Bulamu Test Facility with an account for every role, and emails the logins to the address given (not used as a login)', async () => {
    const res = await create(await operator());
    expect(res.statusCode).toBe(200);
    const { accounts, created } = res.json();
    expect(created).toBe(true);
    expect(accounts.map((a: any) => a.role).sort()).toEqual(['ADMIN', 'DOCTOR', 'NURSE', 'PHARMACIST', 'STAFF']);
    expect(accounts.every((a: any) => a.email.endsWith('@bulamu.site'))).toBe(true);

    const mail = sendMailMock.mock.calls.map(([m]) => m).find((m) => /demo facility/i.test(m.subject));
    expect(mail.to).toBe('admin@scholara.site');
    for (const account of accounts) {
      expect(mail.html).toContain(account.email);
      expect(mail.html).toContain(account.password);
      // Every role can actually sign in with what was sent.
      const login = await loginAs(app, account.email, account.password);
      expect(login.user.role).toBe(account.role);
    }
    expect(await prisma.user.findUnique({ where: { email: 'admin@scholara.site' } })).toBeNull();
  });

  it('fills it with enough made-up work to show every part of Bulamu', async () => {
    await create(await operator());
    const clinic = await prisma.clinic.findFirstOrThrow({ where: { isDemo: true } });
    const count = async (model: any, where: object) => model.count({ where });
    expect(await count(prisma.patient, { clinicId: clinic.id })).toBe(8);
    expect(await count(prisma.consultation, { patient: { clinicId: clinic.id } })).toBe(5);
    expect(await count(prisma.prescription, { consultation: { patient: { clinicId: clinic.id } } })).toBeGreaterThan(4);
    expect(await count(prisma.invoice, { clinicId: clinic.id })).toBe(5);
    expect(await count(prisma.labTest, { patient: { clinicId: clinic.id } })).toBe(4);
    expect(await count(prisma.medicine, { clinicId: clinic.id })).toBe(6);
    expect(await count(prisma.ward, { clinicId: clinic.id })).toBe(3);
    expect(await count(prisma.admission, { clinicId: clinic.id, status: 'ADMITTED' })).toBe(1);
    expect(await count(prisma.appointment, { clinicId: clinic.id, status: 'SCHEDULED' })).toBe(3);
    // Every role has something in its notifications.
    for (const role of ['ADMIN', 'DOCTOR', 'NURSE', 'PHARMACIST', 'STAFF'] as const) {
      expect(await count(prisma.notification, { user: { clinicId: clinic.id, role } }), role).toBeGreaterThan(0);
    }
    expect((await prisma.subscription.findUniqueOrThrow({ where: { clinicId: clinic.id } })).status).toBe('ACTIVE');
  });

  it('a second run issues fresh passwords and keeps the data (never a second facility)', async () => {
    const token = await operator();
    const first = (await create(token)).json();
    const second = (await create(token)).json();
    expect(second.created).toBe(false);
    expect(await prisma.clinic.count({ where: { isDemo: true } })).toBe(1);
    expect(await prisma.patient.count({ where: { clinic: { isDemo: true } } })).toBe(8);

    const admin = (r: any) => r.accounts.find((a: any) => a.role === 'ADMIN');
    expect(admin(second).password).not.toBe(admin(first).password);
    const old = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: admin(first).email, password: admin(first).password } });
    expect(old.statusCode).toBe(401);
  });

  it("stays out of the platform's figures, and its staff are never emailed", async () => {
    const token = await operator();
    await create(token);
    const overview = (await app.inject({ method: 'GET', url: '/super-admin/overview', headers: authHeader(token) })).json().overview;
    expect(overview.clinicCount).toBe(0);
    expect(overview.patientCount).toBe(0);

    const clinic = await prisma.clinic.findFirstOrThrow({ where: { isDemo: true } });
    sendMailMock.mockClear();
    await notifyStaff({ type: 'LOW_STOCK', clinicId: clinic.id, title: 't', body: 'b', link: '/inventory', emailSummary: 's' });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(sendMailMock).not.toHaveBeenCalled();
    expect(await prisma.notification.count({ where: { clinicId: clinic.id, type: 'LOW_STOCK', createdAt: { gt: new Date(Date.now() - 5000) } } })).toBe(2);
  });

  it('only the platform administrator can create it, and it needs a real email to send to', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
    const adminToken = (await loginAs(app, user.email, password)).token;
    expect((await create(adminToken)).statusCode).toBe(403);
    expect((await create(await operator(), 'not-an-email')).statusCode).toBe(400);
  });
});
