import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';
import { NOTIFICATION_RULES, notifyPatient, notifyStaff } from '../src/lib/notifications';

const sendMailMock = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/mailer')>();
  return { ...actual, sendMail: sendMailMock };
});

const ROLES = ['ADMIN', 'DOCTOR', 'NURSE', 'PHARMACIST', 'STAFF'] as const;
type Role = (typeof ROLES)[number];

// Every notification type, checked one by one: the in-app notice reaches exactly
// the roles it is for, and the email exactly the roles meant to get one - with
// the right subject and a link back into Bulamu. Types that are in-app only by
// design must never email.
describe('who gets each notification, in the app and by email', () => {
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

  async function facilityWithEveryRole() {
    const clinic = await seedClinic();
    const users = {} as Record<Role, { id: string; email: string }>;
    for (const role of ROLES) {
      const { user } = await seedUser({ clinicId: clinic.id, role, email: `${role.toLowerCase()}@facility.ug` });
      users[role] = { id: user.id, email: user.email };
    }
    return { clinic, users };
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
  const mails = () => sendMailMock.mock.calls.map(([mail]) => mail as { to: string; subject: string; html: string });

  const staffTypes = Object.entries(NOTIFICATION_RULES).filter(([, rule]) => rule.audience === 'STAFF');
  const patientTypes = Object.entries(NOTIFICATION_RULES).filter(([, rule]) => rule.audience === 'PATIENT');

  it.each(staffTypes)('%s', async (type, rule) => {
    if (rule.audience !== 'STAFF') return;
    const { clinic, users } = await facilityWithEveryRole();
    const meant = ROLES.filter((role) => rule.roles.includes(role));

    await notifyStaff({
      type: type as any, clinicId: clinic.id, title: 'Title with details', body: 'Body with details', link: '/notifications',
      emailSummary: 'A generic summary.',
      // A personal notification goes to the people named (e.g. the clinician who ordered the test).
      ...(rule.personal ? { userIds: meant.map((role) => users[role].id) } : {}),
    });
    await settle();

    const inApp = await prisma.notification.findMany({ where: { clinicId: clinic.id, type: type as any }, select: { userId: true } });
    expect(inApp.map((n) => n.userId).sort()).toEqual(meant.map((role) => users[role].id).sort());

    const emailed = ROLES.filter((role) => rule.emailRoles.includes(role) && rule.roles.includes(role));
    expect(mails().map((m) => m.to).sort()).toEqual(emailed.map((role) => users[role].email).sort());
    for (const mail of mails()) {
      expect(mail.subject).toBe(rule.emailSubject);
      expect(mail.html).toContain('A generic summary.');
      expect(mail.html).toContain('http://localhost:3000/notifications');
      // Only the generic summary goes by email - never the in-app details.
      expect(mail.html).not.toContain('Body with details');
    }
  });

  it.each(patientTypes)('%s (patient)', async (type, rule) => {
    if (rule.audience !== 'PATIENT') return;
    const { clinic, users } = await facilityWithEveryRole();
    const account = await prisma.patientAccount.create({
      data: {
        portableId: `BLM-P-${Math.random().toString(16).slice(2, 8)}`, phone: '0700000000', phoneKey: '700000000', email: 'patient@example.com',
        password: 'x', status: 'ACTIVE', mustResetPassword: false, createdByClinicId: clinic.id, createdByUserId: users.NURSE.id,
      },
    });

    await notifyPatient({ type: type as any, patientAccountId: account.id, clinicId: clinic.id, title: 'T', body: 'Body with details', link: '/patient-portal/dashboard', emailSummary: 'A generic summary.' });
    await settle();

    expect(await prisma.notification.count({ where: { patientAccountId: account.id, type: type as any } })).toBe(1);
    expect(mails().map((m) => m.to)).toEqual(rule.email ? ['patient@example.com'] : []);
    if (rule.email) {
      expect(mails()[0].subject).toBe(rule.emailSubject);
      expect(mails()[0].html).toContain('http://localhost:3000/patient-portal/dashboard');
      expect(mails()[0].html).not.toContain('Body with details');
    }
  });

  it('skips the email - never the in-app notice - for anyone who switched that email off, and for deactivated staff', async () => {
    const { clinic, users } = await facilityWithEveryRole();
    await prisma.user.update({ where: { id: users.PHARMACIST.id }, data: { emailOptOuts: ['LOW_STOCK'] } });
    await prisma.user.update({ where: { id: users.ADMIN.id }, data: { isActive: false } });

    await notifyStaff({ type: 'LOW_STOCK', clinicId: clinic.id, title: 't', body: 'b', link: '/inventory', emailSummary: 's' });
    await settle();

    expect(mails()).toHaveLength(0);
    const inApp = await prisma.notification.findMany({ where: { type: 'LOW_STOCK' }, select: { userId: true } });
    expect(inApp.map((n) => n.userId)).toEqual([users.PHARMACIST.id]);
  });
});
