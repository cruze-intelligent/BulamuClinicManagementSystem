import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

// These tests build several clinics and users (each a password hash), which is slow on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

const sendMailMock = vi.hoisted(() => vi.fn());

vi.mock('../src/lib/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/mailer')>();
  return { ...actual, sendMail: sendMailMock };
});

type Role = 'ADMIN' | 'DOCTOR' | 'NURSE' | 'PHARMACIST' | 'STAFF';
const PHONE = '0756111222';

describe('notifications', () => {
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

  // One facility with one user of every role.
  async function facility(name = 'Kampala Clinic') {
    const clinic = await seedClinic({ name });
    const users = {} as Record<Role, { id: string; email: string; token: string }>;
    for (const role of ['ADMIN', 'DOCTOR', 'NURSE', 'PHARMACIST', 'STAFF'] as Role[]) {
      const { user, password } = await seedUser({ clinicId: clinic.id, role });
      const { token } = await loginAs(app, user.email, password);
      users[role] = { id: user.id, email: user.email, token };
    }
    return { clinic, users };
  }

  const emailedTo = () => sendMailMock.mock.calls.map(([mail]) => mail.to as string);
  const mailsTo = (address: string) => sendMailMock.mock.calls.map(([mail]) => mail).filter((mail) => mail.to === address);
  const inboxOf = (userId: string) => prisma.notification.findMany({ where: { userId } });

  // Registers a patient with an email, and (optionally) activates their portal account.
  async function portalPatient(staffToken: string, options: { activate?: boolean } = {}) {
    const registered = await app.inject({
      method: 'POST', url: '/patients', headers: authHeader(staffToken),
      payload: { name: 'Jane Mukasa', phone: PHONE, email: 'jane@example.com', sex: 'FEMALE' },
    });
    const { patient, portalInvitation } = registered.json();
    let patientToken: string | undefined;
    if (options.activate !== false) {
      const token = new URL(portalInvitation.devSetPasswordUrl).searchParams.get('token')!;
      await app.inject({ method: 'POST', url: '/patient-auth/set-password', payload: { token, password: 'MyNewPassword123!', phone: PHONE } });
      const login = await app.inject({ method: 'POST', url: '/patient-auth/login', payload: { identifier: 'jane@example.com', password: 'MyNewPassword123!' } });
      patientToken = login.json().token;
    }
    const account = await prisma.patientAccount.findUniqueOrThrow({ where: { email: 'jane@example.com' } });
    sendMailMock.mockClear();
    return { patientId: patient.id as string, accountId: account.id, portableId: account.portableId, patientToken };
  }

  describe('low stock (restock) alerts', () => {
    async function addMedicine(token: string, quantity: number) {
      const response = await app.inject({
        method: 'POST', url: '/inventory', headers: authHeader(token),
        payload: { name: 'Amoxicillin', quantity, unit: 'tablets', reorderLevel: 20, price: 100 },
      });
      return response.json().medicine.id as string;
    }
    const setQuantity = (token: string, id: string, quantity: number) =>
      app.inject({ method: 'PATCH', url: `/inventory/${id}`, headers: authHeader(token), payload: { quantity } });

    it('tells only the pharmacist and admin - in-app and by a generic email - when stock falls to its reorder level', async () => {
      const { users } = await facility();
      const medicineId = await addMedicine(users.PHARMACIST.token, 50);
      expect(await prisma.notification.count()).toBe(0);

      await setQuantity(users.PHARMACIST.token, medicineId, 15);

      expect((await inboxOf(users.PHARMACIST.id)).map((n) => n.type)).toEqual(['LOW_STOCK']);
      expect((await inboxOf(users.ADMIN.id)).map((n) => n.type)).toEqual(['LOW_STOCK']);
      for (const role of ['DOCTOR', 'NURSE', 'STAFF'] as Role[]) {
        expect(await inboxOf(users[role].id)).toHaveLength(0);
      }

      expect(emailedTo().sort()).toEqual([users.ADMIN.email, users.PHARMACIST.email].sort());
      // The email says a restock is needed, but not which medicine
      expect(mailsTo(users.PHARMACIST.email)[0].html).not.toContain('Amoxicillin');
      // The in-app notification, seen after sign-in, does name it
      expect((await inboxOf(users.PHARMACIST.id))[0].body).toContain('Amoxicillin');
    });

    it('alerts once per shortage, not on every change while stock stays low', async () => {
      const { users } = await facility();
      const medicineId = await addMedicine(users.PHARMACIST.token, 50);

      await setQuantity(users.PHARMACIST.token, medicineId, 15);
      await setQuantity(users.PHARMACIST.token, medicineId, 10);
      await setQuantity(users.PHARMACIST.token, medicineId, 3);
      expect(await inboxOf(users.PHARMACIST.id)).toHaveLength(1);

      // Restocked, then running low again is a new shortage
      await setQuantity(users.PHARMACIST.token, medicineId, 100);
      await setQuantity(users.PHARMACIST.token, medicineId, 5);
      expect(await inboxOf(users.PHARMACIST.id)).toHaveLength(2);
    });

    it('alerts when a medicine is added already below its reorder level', async () => {
      const { users } = await facility();
      await addMedicine(users.PHARMACIST.token, 5);
      expect(await inboxOf(users.PHARMACIST.id)).toHaveLength(1);
    });

    it('never alerts another facility\'s staff', async () => {
      const { users } = await facility('Clinic A');
      const other = await facility('Clinic B');
      const medicineId = await addMedicine(users.PHARMACIST.token, 50);
      await setQuantity(users.PHARMACIST.token, medicineId, 5);

      expect(await inboxOf(other.users.PHARMACIST.id)).toHaveLength(0);
      expect(await inboxOf(other.users.ADMIN.id)).toHaveLength(0);
    });

    it('keeps the in-app alert but skips the email once the recipient turns that email off', async () => {
      const { users } = await facility();
      const optOut = await app.inject({
        method: 'PUT', url: '/notifications/preferences', headers: authHeader(users.PHARMACIST.token),
        payload: { emailDisabled: ['LOW_STOCK'] },
      });
      expect(optOut.statusCode).toBe(200);

      const medicineId = await addMedicine(users.PHARMACIST.token, 50);
      await setQuantity(users.PHARMACIST.token, medicineId, 5);

      expect(await inboxOf(users.PHARMACIST.id)).toHaveLength(1);
      expect(emailedTo()).toEqual([users.ADMIN.email]);
    });
  });

  describe('lab results for patients', () => {
    async function orderAndComplete(staffToken: string, patientId: string) {
      const ordered = await app.inject({
        method: 'POST', url: '/lab', headers: authHeader(staffToken),
        payload: { patientId, testName: 'Malaria RDT', orderedBy: 'Dr Okello' },
      });
      const testId = ordered.json().test.id as string;
      const complete = () => app.inject({
        method: 'PATCH', url: `/lab/${testId}`, headers: authHeader(staffToken),
        payload: { results: 'Positive', status: 'COMPLETED' },
      });
      return { testId, complete };
    }

    it('notifies the patient once, in-app and by a generic email with no clinical detail', async () => {
      const { users } = await facility();
      const { patientId, accountId, patientToken } = await portalPatient(users.NURSE.token);
      const { complete } = await orderAndComplete(users.NURSE.token, patientId);

      await complete();

      const inbox = await prisma.notification.findMany({ where: { patientAccountId: accountId } });
      expect(inbox).toHaveLength(1);
      expect(inbox[0].type).toBe('LAB_RESULT_READY');
      expect(inbox[0].body).toContain('Malaria RDT');

      const mail = mailsTo('jane@example.com');
      expect(mail).toHaveLength(1);
      expect(mail[0].html).not.toContain('Malaria');
      expect(mail[0].html).not.toContain('Positive');

      // Completing again (already completed) must not notify a second time
      await complete();
      expect(await prisma.notification.count({ where: { patientAccountId: accountId } })).toBe(1);

      // ...and the patient sees it in their portal
      const list = await app.inject({ method: 'GET', url: '/patient-portal/notifications', headers: authHeader(patientToken!) });
      expect(list.json().unreadCount).toBe(1);
      expect(list.json().notifications[0].title).toBe('Your lab results are ready');
    });

    it('does nothing for a patient without a portal account', async () => {
      const { users } = await facility();
      const registered = await app.inject({
        method: 'POST', url: '/patients', headers: authHeader(users.NURSE.token),
        payload: { name: 'No Account', phone: '0700123123' },
      });
      const { complete } = await orderAndComplete(users.NURSE.token, registered.json().patient.id);
      await complete();

      expect(await prisma.notification.count()).toBe(0);
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it('does not email a patient who has not yet activated their account (in-app only)', async () => {
      const { users } = await facility();
      const { patientId, accountId } = await portalPatient(users.NURSE.token, { activate: false });
      const { complete } = await orderAndComplete(users.NURSE.token, patientId);
      await complete();

      expect(await prisma.notification.count({ where: { patientAccountId: accountId } })).toBe(1);
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it('respects the patient turning email off for lab results', async () => {
      const { users } = await facility();
      const { patientId, accountId, patientToken } = await portalPatient(users.NURSE.token);
      await app.inject({
        method: 'PUT', url: '/patient-portal/notifications/preferences', headers: authHeader(patientToken!),
        payload: { emailDisabled: ['LAB_RESULT_READY'] },
      });
      const { complete } = await orderAndComplete(users.NURSE.token, patientId);
      await complete();

      expect(await prisma.notification.count({ where: { patientAccountId: accountId } })).toBe(1);
      expect(sendMailMock).not.toHaveBeenCalled();
    });
  });

  describe('appointments', () => {
    it('routes a patient\'s request to front desk, nurses and admins - emailing only front desk and admins', async () => {
      const { users } = await facility();
      const { patientId, patientToken } = await portalPatient(users.NURSE.token);

      const request = await app.inject({
        method: 'POST', url: '/patient-portal/appointments/request', headers: authHeader(patientToken!),
        payload: { recordId: patientId, preferredDate: new Date(Date.now() + 86400000).toISOString(), preferredTime: '10:00' },
      });
      expect(request.statusCode).toBe(200);

      for (const role of ['STAFF', 'NURSE', 'ADMIN'] as Role[]) {
        expect((await inboxOf(users[role].id)).map((n) => n.type)).toEqual(['APPOINTMENT_REQUESTED']);
      }
      for (const role of ['DOCTOR', 'PHARMACIST'] as Role[]) {
        expect(await inboxOf(users[role].id)).toHaveLength(0);
      }
      expect(emailedTo().sort()).toEqual([users.ADMIN.email, users.STAFF.email].sort());
    });

    it('tells the patient when their request is confirmed or declined', async () => {
      const { users } = await facility();
      const { patientId, accountId, patientToken } = await portalPatient(users.NURSE.token);
      const future = new Date(Date.now() + 86400000).toISOString();

      const first = (await app.inject({ method: 'POST', url: '/patient-portal/appointments/request', headers: authHeader(patientToken!), payload: { recordId: patientId, preferredDate: future } })).json().appointmentRequest.id;
      const second = (await app.inject({ method: 'POST', url: '/patient-portal/appointments/request', headers: authHeader(patientToken!), payload: { recordId: patientId, preferredDate: future } })).json().appointmentRequest.id;
      sendMailMock.mockClear();

      await app.inject({ method: 'POST', url: `/appointment-requests/${first}/accept`, headers: authHeader(users.STAFF.token), payload: { doctorId: users.DOCTOR.id, date: future, time: '10:00' } });
      await app.inject({ method: 'POST', url: `/appointment-requests/${second}/decline`, headers: authHeader(users.STAFF.token), payload: { reason: 'Fully booked' } });

      const types = (await prisma.notification.findMany({ where: { patientAccountId: accountId } })).map((n) => n.type).sort();
      expect(types).toEqual(['APPOINTMENT_CONFIRMED', 'APPOINTMENT_DECLINED']);
      expect(mailsTo('jane@example.com')).toHaveLength(2);
    });
  });

  it('tells a patient by email and in-app when another facility is given access to their records', async () => {
    const a = await facility('Clinic A');
    const b = await facility('Clinic B');
    const { portableId, accountId } = await portalPatient(a.users.NURSE.token);

    const link = await app.inject({
      method: 'POST', url: '/patients/link-account', headers: authHeader(b.users.NURSE.token),
      payload: { portableId, method: 'PIN', password: 'MyNewPassword123!' },
    });
    expect(link.statusCode).toBe(200);

    const inbox = await prisma.notification.findMany({ where: { patientAccountId: accountId } });
    expect(inbox.map((n) => n.type)).toEqual(['RECORD_ACCESS_GRANTED']);
    expect(inbox[0].body).toContain('Clinic B');
    expect(mailsTo('jane@example.com')).toHaveLength(1);
  });

  it('tells a facility\'s admins and doctors - not other roles or facilities - about a referral', async () => {
    const a = await facility('Clinic A');
    const b = await facility('Clinic B');
    const registered = await app.inject({ method: 'POST', url: '/patients', headers: authHeader(a.users.NURSE.token), payload: { name: 'Referred Patient', phone: '0700555666' } });

    const referral = await app.inject({
      method: 'POST', url: '/referrals', headers: authHeader(a.users.NURSE.token),
      payload: { patientId: registered.json().patient.id, toClinicId: b.clinic.id, reason: 'Needs surgery' },
    });
    expect(referral.statusCode).toBe(200);

    expect((await inboxOf(b.users.ADMIN.id)).map((n) => n.type)).toEqual(['REFERRAL_RECEIVED']);
    expect((await inboxOf(b.users.DOCTOR.id)).map((n) => n.type)).toEqual(['REFERRAL_RECEIVED']);
    for (const role of ['NURSE', 'PHARMACIST', 'STAFF'] as Role[]) {
      expect(await inboxOf(b.users[role].id)).toHaveLength(0);
    }
    expect(await prisma.notification.count({ where: { userId: { in: Object.values(a.users).map((u) => u.id) } } })).toBe(0);
  });

  it('tells the pharmacist, in-app only, when a consultation prescribes something', async () => {
    const { users } = await facility();
    const registered = await app.inject({ method: 'POST', url: '/patients', headers: authHeader(users.NURSE.token), payload: { name: 'Rx Patient', phone: '0700777888' } });
    const patientId = registered.json().patient.id;
    const appointment = await app.inject({ method: 'POST', url: '/appointments', headers: authHeader(users.DOCTOR.token), payload: { patientId, doctorId: users.DOCTOR.id, date: new Date().toISOString(), time: '09:00' } });

    await app.inject({
      method: 'POST', url: '/consultations', headers: authHeader(users.DOCTOR.token),
      payload: {
        appointmentId: appointment.json().appointment.id, patientId, diagnosis: 'Malaria', symptoms: 'Fever',
        prescriptions: [{ medication: 'Coartem', dosage: '4 tablets', frequency: 'twice daily', duration: '3 days' }],
      },
    });

    expect((await inboxOf(users.PHARMACIST.id)).map((n) => n.type)).toEqual(['NEW_PRESCRIPTION']);
    expect(await inboxOf(users.NURSE.id)).toHaveLength(0);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('tells admins - but not the author - about a note on a record, without putting the note in the email', async () => {
    const { users } = await facility();
    const registered = await app.inject({ method: 'POST', url: '/patients', headers: authHeader(users.NURSE.token), payload: { name: 'Noted Patient', phone: '0700999000' } });

    await app.inject({
      method: 'POST', url: '/comments', headers: authHeader(users.NURSE.token),
      payload: { entityType: 'PATIENT', entityId: registered.json().patient.id, body: 'Patient reports a sensitive complaint' },
    });

    expect((await inboxOf(users.ADMIN.id)).map((n) => n.type)).toEqual(['NEW_NOTE']);
    expect(await inboxOf(users.NURSE.id)).toHaveLength(0);
    expect(mailsTo(users.ADMIN.email)[0].html).not.toContain('sensitive complaint');
  });

  describe('reading and managing your own notifications', () => {
    async function withOneNotification() {
      const { users } = await facility();
      const other = await facility('Other Clinic');
      const medicineId = (await app.inject({ method: 'POST', url: '/inventory', headers: authHeader(users.PHARMACIST.token), payload: { name: 'Zinc', quantity: 3, unit: 'tablets', reorderLevel: 20, price: 10 } })).json().medicine.id;
      const notification = (await inboxOf(users.PHARMACIST.id))[0];
      return { users, other, medicineId, notification };
    }

    it('lists, counts and marks notifications read - only the caller\'s own', async () => {
      const { users, other, notification } = await withOneNotification();

      const list = await app.inject({ method: 'GET', url: '/notifications', headers: authHeader(users.PHARMACIST.token) });
      expect(list.json().notifications).toHaveLength(1);
      expect(list.json().unreadCount).toBe(1);

      // Someone else cannot mark it read, nor see that it exists
      const stolen = await app.inject({ method: 'POST', url: `/notifications/${notification.id}/read`, headers: authHeader(other.users.PHARMACIST.token) });
      expect(stolen.statusCode).toBe(404);
      expect((await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } })).readAt).toBeNull();

      const read = await app.inject({ method: 'POST', url: `/notifications/${notification.id}/read`, headers: authHeader(users.PHARMACIST.token) });
      expect(read.statusCode).toBe(200);
      const count = await app.inject({ method: 'GET', url: '/notifications/unread-count', headers: authHeader(users.PHARMACIST.token) });
      expect(count.json().count).toBe(0);
    });

    it('marks all of a user\'s notifications read without touching anyone else\'s', async () => {
      const { users } = await withOneNotification();

      await app.inject({ method: 'POST', url: '/notifications/read-all', headers: authHeader(users.PHARMACIST.token) });

      expect((await inboxOf(users.PHARMACIST.id))[0].readAt).not.toBeNull();
      expect((await inboxOf(users.ADMIN.id))[0].readAt).toBeNull();
    });

    it('only offers each role the notifications that apply to it, and only lets it opt out of emails it could receive', async () => {
      const { users } = await facility();

      const prefs = await app.inject({ method: 'GET', url: '/notifications/preferences', headers: authHeader(users.PHARMACIST.token) });
      const types = prefs.json().preferences.map((p: any) => p.type).sort();
      expect(types).toEqual(['LOW_STOCK', 'NEW_PRESCRIPTION']);
      const emailable = prefs.json().preferences.filter((p: any) => p.emailAvailable).map((p: any) => p.type);
      expect(emailable).toEqual(['LOW_STOCK']);

      // NEW_PRESCRIPTION is never emailed and REFERRAL_RECEIVED isn't theirs - both ignored
      const update = await app.inject({
        method: 'PUT', url: '/notifications/preferences', headers: authHeader(users.PHARMACIST.token),
        payload: { emailDisabled: ['LOW_STOCK', 'NEW_PRESCRIPTION', 'REFERRAL_RECEIVED', 'NOT_A_TYPE'] },
      });
      expect(update.statusCode).toBe(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: users.PHARMACIST.id } })).emailOptOuts).toEqual(['LOW_STOCK']);

      const nurse = await app.inject({ method: 'GET', url: '/notifications/preferences', headers: authHeader(users.NURSE.token) });
      expect(nurse.json().preferences.map((p: any) => p.type)).toEqual(['APPOINTMENT_REQUESTED']);
    });

    it('removes notifications older than the retention period when the list is opened', async () => {
      const { users } = await facility();
      const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
      await prisma.notification.create({ data: { userId: users.NURSE.id, type: 'APPOINTMENT_REQUESTED', title: 'Old', body: 'Old', createdAt: old } });
      await prisma.notification.create({ data: { userId: users.NURSE.id, type: 'APPOINTMENT_REQUESTED', title: 'Recent', body: 'Recent' } });

      const list = await app.inject({ method: 'GET', url: '/notifications', headers: authHeader(users.NURSE.token) });
      expect(list.json().notifications.map((n: any) => n.title)).toEqual(['Recent']);
      expect(await prisma.notification.count({ where: { userId: users.NURSE.id } })).toBe(1);
    });

    it('keeps staff and patient notification endpoints separate', async () => {
      const { users } = await facility();
      const { patientToken } = await portalPatient(users.NURSE.token);

      expect((await app.inject({ method: 'GET', url: '/patient-portal/notifications', headers: authHeader(users.NURSE.token) })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url: '/notifications', headers: authHeader(patientToken!) })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url: '/notifications' })).statusCode).toBe(401);
    });
  });
});
