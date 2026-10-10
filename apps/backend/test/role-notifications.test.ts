import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';
import { NOTIFICATION_RULES, runPeriodicChecks } from '../src/lib/notifications';

vi.setConfig({ testTimeout: 60_000 });

const sendMailMock = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/mailer')>();
  return { ...actual, sendMail: sendMailMock };
});

type Role = 'ADMIN' | 'DOCTOR' | 'NURSE' | 'PHARMACIST' | 'STAFF';
const DAY = 24 * 60 * 60 * 1000;

describe('every notification reaches the people it is meant for', () => {
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

  // One facility with one user of every role, plus a second doctor and nurse.
  async function facility(name = 'Kampala Clinic') {
    const clinic = await seedClinic({ name, phone: `07${Math.floor(10000000 + Math.random() * 89999999)}` });
    const users = {} as Record<Role | 'DOCTOR2' | 'NURSE2', { id: string; email: string; token: string }>;
    for (const [key, role] of [['ADMIN', 'ADMIN'], ['DOCTOR', 'DOCTOR'], ['DOCTOR2', 'DOCTOR'], ['NURSE', 'NURSE'], ['NURSE2', 'NURSE'], ['PHARMACIST', 'PHARMACIST'], ['STAFF', 'STAFF']] as const) {
      const { user, password } = await seedUser({ clinicId: clinic.id, role, name: key });
      users[key] = { id: user.id, email: user.email, token: (await loginAs(app, user.email, password)).token };
    }
    const patient = await prisma.patient.create({ data: { name: 'Juma Okello', phone: '0700123456', clinicId: clinic.id } });
    return { clinic, users, patient };
  }

  const inbox = (userId: string) => prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  const types = async (userId: string) => (await inbox(userId)).map((n) => n.type);
  const emailedTo = () => sendMailMock.mock.calls.map(([mail]) => mail.to as string);

  it('has a rule for every notification type, each naming who receives it', () => {
    for (const [type, rule] of Object.entries(NOTIFICATION_RULES)) {
      expect(rule.label, type).toBeTruthy();
      if (rule.audience === 'STAFF') {
        expect(rule.roles.length, type).toBeGreaterThan(0);
        for (const role of rule.emailRoles) expect(rule.roles, `${type} emails a role it does not notify`).toContain(role);
      }
    }
  });

  describe('stock', () => {
    it('warns pharmacists and admins once when a medicine runs out completely', async () => {
      const { users } = await facility();
      const id = (await app.inject({ method: 'POST', url: '/inventory', headers: authHeader(users.PHARMACIST.token), payload: { name: 'Coartem', quantity: 10, unit: 'packs', reorderLevel: 20, price: 5000 } })).json().medicine.id;
      await prisma.notification.deleteMany();
      sendMailMock.mockClear();

      await app.inject({ method: 'PATCH', url: `/inventory/${id}`, headers: authHeader(users.PHARMACIST.token), payload: { quantity: 0 } });
      await app.inject({ method: 'PATCH', url: `/inventory/${id}`, headers: authHeader(users.PHARMACIST.token), payload: { quantity: 0 } });

      expect(await types(users.PHARMACIST.id)).toEqual(['OUT_OF_STOCK']);
      expect(await types(users.ADMIN.id)).toEqual(['OUT_OF_STOCK']);
      for (const key of ['DOCTOR', 'NURSE', 'STAFF'] as const) expect(await inbox(users[key].id)).toHaveLength(0);
      expect(emailedTo().sort()).toEqual([users.ADMIN.email, users.PHARMACIST.email].sort());
    });

    it('warns about stock expiring within 60 days, and again once it has expired - each only once', async () => {
      const { clinic, users } = await facility();
      const now = new Date('2026-10-10T08:00:00Z');
      const med = await prisma.medicine.create({ data: { clinicId: clinic.id, name: 'Oxytocin', quantity: 40, unit: 'ampoules', reorderLevel: 10, price: 2000, expiryDate: new Date(now.getTime() + 30 * DAY) } });
      await prisma.medicine.create({ data: { clinicId: clinic.id, name: 'Far off', quantity: 40, unit: 'tabs', reorderLevel: 10, price: 1, expiryDate: new Date(now.getTime() + 200 * DAY) } });
      await prisma.medicine.create({ data: { clinicId: clinic.id, name: 'Used up', quantity: 0, unit: 'tabs', reorderLevel: 10, price: 1, expiryDate: new Date(now.getTime() + 5 * DAY) } });

      await runPeriodicChecks(clinic.id, now);
      await runPeriodicChecks(clinic.id, new Date(now.getTime() + DAY)); // a day later: nothing new
      let pharmacist = await inbox(users.PHARMACIST.id);
      expect(pharmacist.map((n) => n.title)).toEqual(['Expiring soon: Oxytocin']);
      expect(emailedTo().filter((to) => to === users.PHARMACIST.email)).toHaveLength(1);

      await runPeriodicChecks(clinic.id, new Date(now.getTime() + 31 * DAY));
      pharmacist = await inbox(users.PHARMACIST.id);
      expect(pharmacist.map((n) => n.title)).toEqual(['Expiring soon: Oxytocin', 'Expired stock: Oxytocin']);
      expect((await inbox(users.ADMIN.id))).toHaveLength(2);
      expect(await inbox(users.DOCTOR.id)).toHaveLength(0);

      // A new batch with a new expiry date is a new warning.
      await prisma.medicine.update({ where: { id: med.id }, data: { expiryDate: new Date(now.getTime() + 80 * DAY) } });
      await runPeriodicChecks(clinic.id, new Date(now.getTime() + 31 * DAY));
      expect(await inbox(users.PHARMACIST.id)).toHaveLength(3);
    });

    it('reminds the admin before the free trial ends, and when it has ended - once each', async () => {
      const { clinic, users } = await facility();
      const now = new Date('2026-10-10T08:00:00Z');
      await prisma.subscription.update({ where: { clinicId: clinic.id }, data: { status: 'TRIALING', trialEndsAt: new Date(now.getTime() + 2 * DAY) } });

      await runPeriodicChecks(clinic.id, now);
      await runPeriodicChecks(clinic.id, now);
      expect((await inbox(users.ADMIN.id)).map((n) => n.title)).toEqual([expect.stringMatching(/^Your free trial ends on/)]);

      await runPeriodicChecks(clinic.id, new Date(now.getTime() + 3 * DAY));
      expect((await inbox(users.ADMIN.id)).map((n) => n.title)[1]).toBe('Your free trial has ended');
      expect(emailedTo().filter((to) => to === users.ADMIN.email)).toHaveLength(2);
      for (const key of ['DOCTOR', 'NURSE', 'PHARMACIST', 'STAFF'] as const) expect(await inbox(users[key].id)).toHaveLength(0);
    });
  });

  describe('laboratory', () => {
    it('sends a new order to the nurses (not the clinician who ordered it), and the result back to that clinician only', async () => {
      const { users, patient } = await facility();
      const ordered = await app.inject({ method: 'POST', url: '/lab', headers: authHeader(users.DOCTOR.token), payload: { patientId: patient.id, testName: 'Malaria RDT', orderedBy: 'DOCTOR' } });
      expect(ordered.json().test.orderedByUserId).toBe(users.DOCTOR.id);

      expect(await types(users.NURSE.id)).toEqual(['LAB_TEST_ORDERED']);
      expect(await types(users.NURSE2.id)).toEqual(['LAB_TEST_ORDERED']);
      expect(await inbox(users.DOCTOR.id)).toHaveLength(0);
      expect((await inbox(users.NURSE.id))[0].body).toBe('Malaria RDT was ordered for Juma Okello.');

      await app.inject({ method: 'PATCH', url: `/lab/${ordered.json().test.id}`, headers: authHeader(users.NURSE.token), payload: { results: 'Positive (P. falciparum)', status: 'COMPLETED' } });
      expect(await types(users.DOCTOR.id)).toEqual(['LAB_RESULT_AVAILABLE']);
      expect(await inbox(users.DOCTOR2.id)).toHaveLength(0);
      expect(emailedTo()).toEqual([users.DOCTOR.email]);
      expect(sendMailMock.mock.calls[0][0].html).not.toContain('falciparum');
    });

    it('does not tell clinicians what they did themselves', async () => {
      const { users, patient } = await facility();
      const ordered = await app.inject({ method: 'POST', url: '/lab', headers: authHeader(users.NURSE.token), payload: { patientId: patient.id, testName: 'Hb', orderedBy: 'NURSE' } });
      expect(await inbox(users.NURSE.id)).toHaveLength(0);
      expect(await types(users.NURSE2.id)).toEqual(['LAB_TEST_ORDERED']);
      await app.inject({ method: 'PATCH', url: `/lab/${ordered.json().test.id}`, headers: authHeader(users.NURSE.token), payload: { results: '12.1', status: 'COMPLETED' } });
      expect(await inbox(users.NURSE.id)).toHaveLength(0);
    });
  });

  describe('appointments', () => {
    it('tells the doctor - only that doctor - when a patient is booked into, or cancelled from, their list', async () => {
      const { users, patient } = await facility();
      const booked = await app.inject({
        method: 'POST', url: '/appointments', headers: authHeader(users.STAFF.token),
        payload: { patientId: patient.id, doctorId: users.DOCTOR.id, date: '2026-10-12', time: '10:30' },
      });
      expect(booked.statusCode).toBe(200);
      expect(await types(users.DOCTOR.id)).toEqual(['APPOINTMENT_BOOKED']);
      expect((await inbox(users.DOCTOR.id))[0].body).toBe('Juma Okello has been booked to see you on 12 Oct 2026 at 10:30.');
      expect(await inbox(users.DOCTOR2.id)).toHaveLength(0);
      expect(await inbox(users.NURSE.id)).toHaveLength(0);

      await app.inject({ method: 'PATCH', url: `/appointments/${booked.json().appointment.id}`, headers: authHeader(users.STAFF.token), payload: { status: 'CANCELLED' } });
      expect(await types(users.DOCTOR.id)).toEqual(['APPOINTMENT_BOOKED', 'APPOINTMENT_CANCELLED']);
      expect(sendMailMock).not.toHaveBeenCalled(); // in-app only
    });

    it('does not notify a doctor who books the patient themselves', async () => {
      const { users, patient } = await facility();
      await app.inject({ method: 'POST', url: '/appointments', headers: authHeader(users.DOCTOR.token), payload: { patientId: patient.id, doctorId: users.DOCTOR.id, date: '2026-10-12', time: '10:30' } });
      expect(await inbox(users.DOCTOR.id)).toHaveLength(0);
    });

    it('notifies the doctor of bookings that arrive by offline sync too', async () => {
      const { clinic, users, patient } = await facility();
      await app.inject({
        method: 'POST', url: '/sync/push', headers: authHeader(users.NURSE.token),
        payload: { operations: [{ id: 'm1', entity: 'appointment', clinicId: clinic.id, payload: { id: '7a3c1d2e-0000-4000-8000-000000000001', patientId: patient.id, doctorId: users.DOCTOR2.id, date: '2026-10-13', time: '08:00', updatedAt: new Date().toISOString() } }] },
      });
      expect(await types(users.DOCTOR2.id)).toEqual(['APPOINTMENT_BOOKED']);
    });
  });

  it('never notifies another facility\'s staff', async () => {
    const a = await facility('Clinic A');
    const b = await facility('Clinic B');
    await app.inject({ method: 'POST', url: '/lab', headers: authHeader(a.users.DOCTOR.token), payload: { patientId: a.patient.id, testName: 'CBC', orderedBy: 'x' } });
    await app.inject({ method: 'POST', url: '/appointments', headers: authHeader(a.users.STAFF.token), payload: { patientId: a.patient.id, doctorId: a.users.DOCTOR.id, date: '2026-10-12', time: '09:00' } });
    const bIds = Object.values(b.users).map((u) => u.id);
    expect(await prisma.notification.count({ where: { userId: { in: bIds } } })).toBe(0);
  });
});
