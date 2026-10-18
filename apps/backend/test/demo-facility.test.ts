import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';
import { notifyStaff } from '../src/lib/notifications';
import { setUsageTrackingEnabled } from '../src/lib/usage-tracking';

const sendMailMock = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/mailer')>();
  return { ...actual, sendMail: sendMailMock };
});

describe('demo facilities', () => {
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

  it('creates a private demo with a sign-in for every role, and emails them to the address given (not used as a login)', async () => {
    const res = await create(await operator());
    expect(res.statusCode).toBe(200);
    const { accounts, password, demoCode, expiresAt } = res.json();
    expect(accounts.map((a: any) => a.role).sort()).toEqual(['ADMIN', 'DOCTOR', 'LAB_TECH', 'NURSE', 'PHARMACIST', 'STAFF']);
    expect(accounts.every((a: any) => a.email.endsWith(`.${demoCode}@demo.bulamu.site`))).toBe(true);
    expect(new Date(expiresAt).getTime() - Date.now()).toBeGreaterThan(13.9 * 24 * 3600 * 1000);

    const mail = sendMailMock.mock.calls.map(([m]) => m).find((m) => /your demo is ready/i.test(m.subject));
    expect(mail.to).toBe('admin@scholara.site');
    expect(mail.html).toContain(password);
    expect(mail.html).toContain('Your guided tour');
    for (const account of accounts) {
      expect(mail.html).toContain(account.email);
      // Every role can actually sign in with what was sent.
      const login = await loginAs(app, account.email, password);
      expect(login.user.role).toBe(account.role);
    }
    expect(await prisma.user.findUnique({ where: { email: 'admin@scholara.site' } })).toBeNull();
  });

  it("includes the patient's side: a Patient Portal sign-in that works with the same password", async () => {
    const demo = (await create(await operator())).json();
    expect(demo.patient).toMatchObject({ name: 'Achieng Mary', email: `patient.${demo.demoCode}@demo.bulamu.site` });
    const mail = sendMailMock.mock.calls.map(([m]) => m).find((m) => /your demo is ready/i.test(m.subject));
    expect(mail.html).toContain(demo.patient.email);
    expect(mail.html).toContain('Finish as the patient');

    const login = await app.inject({ method: 'POST', url: '/patient-auth/login', payload: { identifier: demo.patient.email, password: demo.password } });
    expect(login.statusCode).toBe(200);
    expect(login.json().mustResetPassword).toBe(false);
    const me = await app.inject({ method: 'GET', url: '/patient-portal/me', headers: authHeader(login.json().token) });
    expect(me.statusCode).toBe(200);
    expect(JSON.stringify(me.json())).toContain('Malaria RDT');
  });

  it("a demo's made-up patient can never be found or linked from a real facility", async () => {
    const token = await operator();
    const demo = (await create(token)).json();
    const real = await seedClinic({ name: 'Real Clinic' });
    const { user, password } = await seedUser({ clinicId: real.id, role: 'NURSE' });
    const nurse = (await loginAs(app, user.email, password)).token;
    const lookup = await app.inject({ method: 'POST', url: '/patients/lookup-account', headers: authHeader(nurse), payload: { portableId: demo.patient.portableId } });
    expect(lookup.statusCode).toBe(404);
    // ...and its made-up phone number never blocks a real patient's account.
    const { findAccountByPhone } = await import('../src/lib/patient-account');
    const demoPatient = await prisma.patient.findFirstOrThrow({ where: { patientAccount: { email: demo.patient.email } } });
    expect(await findAccountByPhone(demoPatient.phone, real.id)).toBeNull();
  });

  it('never meets live data: a demo sees only its own partner hospital, and real facilities never see a demo', async () => {
    const token = await operator();
    const demo = (await create(token)).json();
    const real = await seedClinic({ name: 'Real Hospital' });
    const { user, password } = await seedUser({ clinicId: real.id, role: 'DOCTOR' });
    const realDoctor = (await loginAs(app, user.email, password)).token;
    const demoDoctor = (await loginAs(app, demo.accounts.find((a: any) => a.role === 'DOCTOR').email, demo.password)).token;

    const seenByDemo = (await app.inject({ method: 'GET', url: '/clinics', headers: authHeader(demoDoctor) })).json().clinics.map((c: any) => c.name);
    expect(seenByDemo).toEqual(['Bulamu Referral Hospital']);
    const seenByReal = (await app.inject({ method: 'GET', url: '/clinics', headers: authHeader(realDoctor) })).json().clinics.map((c: any) => c.name);
    expect(seenByReal).toContain('Real Hospital');
    expect(seenByReal).not.toContain('Bulamu Referral Hospital');
    expect(seenByReal).not.toContain('Bulamu Test Facility');

    // A made-up patient can never be referred to a real facility.
    const demoClinicId = (await prisma.user.findUniqueOrThrow({ where: { email: demo.accounts[0].email } })).clinicId;
    const patient = await prisma.patient.findFirstOrThrow({ where: { clinicId: demoClinicId, name: 'Mukasa Joseph' } });
    const toReal = await app.inject({
      method: 'POST', url: '/referrals', headers: authHeader(demoDoctor),
      payload: { patientId: patient.id, toClinicId: real.id, reason: 'Review', consentConfirmed: true },
    });
    expect(toReal.statusCode).toBe(404);
    expect(await prisma.referral.count({ where: { toClinicId: real.id } })).toBe(0);
    // ...while the demo's own partner hospital works, both ways.
    const partner = await prisma.clinic.findFirstOrThrow({ where: { parentFacilityId: demoClinicId } });
    const toPartner = await app.inject({
      method: 'POST', url: '/referrals', headers: authHeader(demoDoctor),
      payload: { patientId: patient.id, toClinicId: partner.id, reason: 'Review', consentConfirmed: true },
    });
    expect(toPartner.statusCode).toBe(200);
    expect(await prisma.referral.count({ where: { toClinicId: demoClinicId, status: 'PENDING' } })).toBe(1);

    // The partner hospital is part of the demo, not a demo of its own.
    const usage = (await app.inject({ method: 'GET', url: '/super-admin/demos', headers: authHeader(token) })).json().demos;
    expect(usage).toHaveLength(1);
  });

  it('says sorry and replaces the earlier sign-ins when asked to', async () => {
    const res = await app.inject({ method: 'POST', url: '/super-admin/system/demo-facility', headers: authHeader(await operator()), payload: { email: 'prospect@example.org', replacesEarlier: true } });
    expect(res.statusCode).toBe(200);
    const mail = sendMailMock.mock.calls.map(([m]) => m).find((m) => m.to === 'prospect@example.org');
    expect(mail.subject).toBe('Your Bulamu demo, with new sign-ins that work');
    expect(mail.html).toContain('the sign-ins we sent you earlier did not work');
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
    // Results entered by the lab technician; one still waiting for a clinician to verify it.
    expect(await count(prisma.labTest, { patient: { clinicId: clinic.id }, resultedBy: { role: 'LAB_TECH' } })).toBe(3);
    expect(await count(prisma.labTest, { patient: { clinicId: clinic.id }, status: 'COMPLETED', verifiedAt: null })).toBe(1);
    expect(await count(prisma.consultation, { patient: { clinicId: clinic.id }, recordedByUserId: { not: null } })).toBe(5);
    expect(await count(prisma.medicine, { clinicId: clinic.id })).toBe(6);
    expect(await count(prisma.ward, { clinicId: clinic.id })).toBe(3);
    expect(await count(prisma.admission, { clinicId: clinic.id, status: 'ADMITTED' })).toBe(1);
    expect(await count(prisma.appointment, { clinicId: clinic.id, status: 'SCHEDULED' })).toBe(3);
    // Every role has something in its notifications.
    for (const role of ['ADMIN', 'DOCTOR', 'NURSE', 'PHARMACIST', 'STAFF', 'LAB_TECH'] as const) {
      expect(await count(prisma.notification, { user: { clinicId: clinic.id, role } }), role).toBeGreaterThan(0);
    }
    expect((await prisma.subscription.findUniqueOrThrow({ where: { clinicId: clinic.id } })).status).toBe('ACTIVE');
  });

  it('every demo is its own: sending another never touches logins already sent', async () => {
    const token = await operator();
    const first = (await create(token, 'first@example.org')).json();
    const second = (await create(token, 'second@example.org')).json();
    expect(await prisma.clinic.count({ where: { isDemo: true } })).toBe(2);
    expect(second.demoCode).not.toBe(first.demoCode);
    expect(second.password).not.toBe(first.password);

    const admin = (r: any) => r.accounts.find((a: any) => a.role === 'ADMIN');
    for (const demo of [first, second]) {
      const login = await loginAs(app, admin(demo).email, demo.password);
      expect(login.user.clinicId).toBe((await prisma.user.findUniqueOrThrow({ where: { email: admin(demo).email } })).clinicId);
    }
    // Each sees only its own records.
    const firstClinic = (await prisma.user.findUniqueOrThrow({ where: { email: admin(first).email } })).clinicId;
    const secondClinic = (await prisma.user.findUniqueOrThrow({ where: { email: admin(second).email } })).clinicId;
    expect(firstClinic).not.toBe(secondClinic);
  });

  it("keeps how a demo was used, never who it was sent to", async () => {
    const token = await operator();
    const demo = (await create(token, 'prospect@example.org')).json();
    const doctor = demo.accounts.find((a: any) => a.role === 'DOCTOR');
    setUsageTrackingEnabled(true);
    try {
      await loginAs(app, doctor.email, demo.password);
      await app.inject({ method: 'POST', url: '/auth/login', payload: { email: doctor.email, password: 'wrong-password' } });
      await vi.waitFor(async () => {
        expect(await prisma.loginEvent.count()).toBe(2);
        expect((await prisma.user.findUniqueOrThrow({ where: { email: doctor.email } })).lastLoginAt).not.toBeNull();
      });
    } finally {
      setUsageTrackingEnabled(false);
    }

    const res = await app.inject({ method: 'GET', url: '/super-admin/demos', headers: authHeader(token) });
    expect(res.statusCode).toBe(200);
    const [usage] = res.json().demos;
    expect(usage).toMatchObject({ demoCode: demo.demoCode, open: true, signIns: 1, failedSignIns: 1, rolesTried: ['Doctor / Clinical Officer'] });
    expect(JSON.stringify(res.json())).not.toContain('prospect@example.org');
    const audit = await prisma.auditLog.findMany();
    expect(JSON.stringify(audit)).not.toContain('prospect@example.org');

    // ...and none of it counts in the platform's own figures.
    const analytics = (await app.inject({ method: 'GET', url: '/super-admin/analytics?days=30', headers: authHeader(token) })).json().analytics;
    expect(analytics.security.signIns).toBe(0);
    expect(analytics.security.wrongPassword).toBe(0);
    expect(analytics.headline.patients.new).toBe(0);
  });

  it('closes after 14 days (or when closed early): its sign-ins stop with a clear reason', async () => {
    const token = await operator();
    const demo = (await create(token)).json();
    const admin = demo.accounts.find((a: any) => a.role === 'ADMIN');
    const session = (await loginAs(app, admin.email, demo.password)).token;
    const clinicId = (await prisma.user.findUniqueOrThrow({ where: { email: admin.email } })).clinicId;

    await prisma.clinic.update({ where: { id: clinicId }, data: { demoExpiresAt: new Date(Date.now() - 1000) } });
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: admin.email, password: demo.password } });
    expect(login.statusCode).toBe(403);
    expect(login.json().reason).toBe('DEMO_ENDED');
    // A session already open ends too.
    expect((await app.inject({ method: 'GET', url: '/patients/' + clinicId, headers: authHeader(session) })).statusCode).toBe(401);

    const usage = (await app.inject({ method: 'GET', url: '/super-admin/demos', headers: authHeader(token) })).json().demos;
    expect(usage[0].open).toBe(false);
    expect((await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId } })).deletedAt).not.toBeNull();

    const other = (await create(token)).json();
    const otherClinic = (await prisma.user.findUniqueOrThrow({ where: { email: other.accounts[0].email } })).clinicId;
    expect((await app.inject({ method: 'POST', url: `/super-admin/demos/${otherClinic}/close`, headers: authHeader(token) })).statusCode).toBe(200);
    const closed = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: other.accounts[0].email, password: other.password } });
    expect(closed.json().reason).toBe('DEMO_ENDED');
    // The demo patient's portal sign-in closes with it.
    const portal = await app.inject({ method: 'POST', url: '/patient-auth/login', payload: { identifier: other.patient.email, password: other.password } });
    expect(portal.json().reason).toBe('DEMO_ENDED');
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
