import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { authHeader, buildTestApp, loginAs, seedClinic, seedUser } from './helpers';
import { resetDb } from './db';
import { ADMIN_NOTIFY_EMAIL } from '../src/lib/mailer';

const sendMailMock = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/mailer')>();
  return { ...actual, sendMail: sendMailMock };
});

 describe('in-app chat', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue({ sent: true, via: 'test' });
    await resetDb();
    app = await buildTestApp();
  });
  afterAll(async () => { await app?.close(); });

  it('opens staff DMs within a facility and hides them from other facilities and non-participants', async () => {
    const clinic = await seedClinic();
    const otherClinic = await seedClinic();
    const { user: alice, password: alicePassword } = await seedUser({ clinicId: clinic.id, role: 'DOCTOR' });
    const { user: bob, password: bobPassword } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const { user: carol, password: carolPassword } = await seedUser({ clinicId: clinic.id, role: 'STAFF' });
    const { user: outsider, password: outsiderPassword } = await seedUser({ clinicId: otherClinic.id, role: 'DOCTOR' });
    const { user: admin, password: adminPassword } = await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
    const aliceToken = (await loginAs(app, alice.email, alicePassword)).token;
    const bobToken = (await loginAs(app, bob.email, bobPassword)).token;
    const carolToken = (await loginAs(app, carol.email, carolPassword)).token;
    const outsiderToken = (await loginAs(app, outsider.email, outsiderPassword)).token;
    const adminToken = (await loginAs(app, admin.email, adminPassword)).token;

    const opened = await app.inject({ method: 'POST', url: '/chat/threads', headers: authHeader(aliceToken), payload: { toUserId: bob.id } });
    expect(opened.statusCode).toBe(200);
    const threadId = opened.json().thread.id;
    const sent = await app.inject({ method: 'POST', url: `/chat/threads/${threadId}/messages`, headers: authHeader(aliceToken), payload: { body: 'Morning team' } });
    expect(sent.statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/chat/threads/${threadId}/messages`, headers: authHeader(aliceToken), payload: { body: 'Email is support only', sendEmail: true } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `/chat/threads/${threadId}/messages`, headers: authHeader(bobToken) })).json().messages[0].body).toBe('Morning team');
    expect((await app.inject({ method: 'GET', url: `/chat/threads/${threadId}/messages`, headers: authHeader(carolToken) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/chat/threads/${threadId}/messages`, headers: authHeader(outsiderToken), payload: { body: 'No access' } })).statusCode).toBe(404);
    const deletion = await app.inject({ method: 'DELETE', url: `/users/${bob.id}`, headers: authHeader(adminToken) });
    expect(deletion.statusCode).toBe(409);
    expect(deletion.json().reason).toBe('HAS_CHAT_HISTORY');
  });

  it('shares one facility support thread between admins and the super-admin inbox', async () => {
    const clinic = await seedClinic();
    const { user: adminA, password: passwordA } = await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
    const { user: adminB, password: passwordB } = await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
    const { user: superAdmin, password: superPassword } = await seedUser({ clinicId: clinic.id, role: 'SUPER_ADMIN' });
    const { user: secondSuperAdmin, password: secondSuperPassword } = await seedUser({ clinicId: clinic.id, role: 'SUPER_ADMIN' });
    const adminAToken = (await loginAs(app, adminA.email, passwordA)).token;
    const adminBToken = (await loginAs(app, adminB.email, passwordB)).token;
    const superToken = (await loginAs(app, superAdmin.email, superPassword)).token;
    const secondSuperToken = (await loginAs(app, secondSuperAdmin.email, secondSuperPassword)).token;

    const [first, second] = await Promise.all([
      app.inject({ method: 'POST', url: '/chat/admin-support', headers: authHeader(adminAToken) }),
      app.inject({ method: 'POST', url: '/chat/admin-support', headers: authHeader(adminBToken) }),
    ]);
    expect(first.statusCode).toBe(200);
    expect(second.json().thread.id).toBe(first.json().thread.id);
    const threadId = first.json().thread.id;
    expect((await app.inject({ method: 'POST', url: `/chat/threads/${threadId}/messages`, headers: authHeader(adminBToken), payload: { body: 'We need help' } })).statusCode).toBe(200);
    const inbox = await app.inject({ method: 'GET', url: '/chat/super-admin/threads', headers: authHeader(superToken) });
    expect(inbox.json().threads).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/chat/super-admin/unread-count', headers: authHeader(superToken) })).json().count).toBe(1);
    expect((await app.inject({ method: 'POST', url: `/chat/super-admin/threads/${threadId}/read`, headers: authHeader(superToken) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/chat/super-admin/unread-count', headers: authHeader(superToken) })).json().count).toBe(0);
    expect((await app.inject({ method: 'GET', url: '/chat/super-admin/unread-count', headers: authHeader(secondSuperToken) })).json().count).toBe(1);
    expect((await app.inject({ method: 'POST', url: `/chat/super-admin/threads/${threadId}/messages`, headers: authHeader(superToken), payload: { body: 'How can we help?' } })).statusCode).toBe(200);
    const replies = await app.inject({ method: 'GET', url: `/chat/threads/${threadId}/messages`, headers: authHeader(adminBToken) });
    expect(replies.json().messages.map((message: { body: string }) => message.body)).toContain('How can we help?');
    expect((await app.inject({ method: 'GET', url: '/chat/unread-count', headers: authHeader(adminAToken) })).json().count).toBe(1);
    expect((await app.inject({ method: 'POST', url: `/chat/threads/${threadId}/read`, headers: authHeader(adminAToken) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/chat/unread-count', headers: authHeader(adminAToken) })).json().count).toBe(0);
    expect((await app.inject({ method: 'GET', url: '/chat/unread-count', headers: authHeader(adminBToken) })).json().count).toBe(1);
  });

  it('emails only a generic secure notice for admin and super-admin support messages', async () => {
    const clinic = await seedClinic();
    const { user: adminA, password: passwordA } = await seedUser({ clinicId: clinic.id, role: 'ADMIN', email: 'admin-a@facility.ug' });
    const { user: adminB, password: passwordB } = await seedUser({ clinicId: clinic.id, role: 'ADMIN', email: 'admin-b@facility.ug' });
    const { user: superAdmin, password: superPassword } = await seedUser({ clinicId: clinic.id, role: 'SUPER_ADMIN' });
    const adminToken = (await loginAs(app, adminA.email, passwordA)).token;
    const superToken = (await loginAs(app, superAdmin.email, superPassword)).token;
    const { thread } = (await app.inject({ method: 'POST', url: '/chat/admin-support', headers: authHeader(adminToken) })).json();

    const privateBody = 'PRIVATE CLINICAL MESSAGE 8391';
    const sentByAdmin = await app.inject({ method: 'POST', url: `/chat/threads/${thread.id}/messages`, headers: authHeader(adminToken), payload: { body: privateBody, sendEmail: true } });
    expect(sentByAdmin.statusCode).toBe(200);
    expect(sendMailMock.mock.calls[0][0]).toMatchObject({ to: ADMIN_NOTIFY_EMAIL, subject: 'New secure message in Bulamu Chatroom' });
    expect(sendMailMock.mock.calls[0][0].html).toContain('Sign in to view the message');
    expect(sendMailMock.mock.calls[0][0].html).not.toContain(privateBody);

    sendMailMock.mockClear();
    const sentBySuper = await app.inject({ method: 'POST', url: `/chat/super-admin/threads/${thread.id}/messages`, headers: authHeader(superToken), payload: { body: privateBody, sendEmail: true } });
    expect(sentBySuper.statusCode).toBe(200);
    expect(sendMailMock.mock.calls.map(([mail]) => (mail as { to: string }).to).sort()).toEqual([adminA.email, adminB.email].sort());
    for (const [mail] of sendMailMock.mock.calls) expect((mail as { html: string }).html).not.toContain(privateBody);
  });

  it('scopes facility, role and custom rooms and keeps pins private to each inbox', async () => {
    const clinic = await seedClinic();
    const otherClinic = await seedClinic();
    const { user: alice, password: alicePassword } = await seedUser({ clinicId: clinic.id, role: 'DOCTOR' });
    const { user: bob, password: bobPassword } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const { user: carol, password: carolPassword } = await seedUser({ clinicId: clinic.id, role: 'DOCTOR' });
    const { user: platformAdmin, password: platformPassword } = await seedUser({ clinicId: clinic.id, role: 'SUPER_ADMIN' });
    const { user: outsider, password: outsiderPassword } = await seedUser({ clinicId: otherClinic.id, role: 'DOCTOR' });
    const aliceToken = (await loginAs(app, alice.email, alicePassword)).token;
    const bobToken = (await loginAs(app, bob.email, bobPassword)).token;
    const carolToken = (await loginAs(app, carol.email, carolPassword)).token;
    const outsiderToken = (await loginAs(app, outsider.email, outsiderPassword)).token;
    const platformToken = (await loginAs(app, platformAdmin.email, platformPassword)).token;

    const facility = await app.inject({ method: 'POST', url: '/chat/groups', headers: authHeader(aliceToken), payload: { groupType: 'FACILITY' } });
    expect(facility.statusCode).toBe(200);
    const facilityId = facility.json().thread.id;
    expect((await app.inject({ method: 'POST', url: `/chat/threads/${facilityId}/messages`, headers: authHeader(bobToken), payload: { body: 'Facility-wide note' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/chat/threads/${facilityId}/messages`, headers: authHeader(outsiderToken) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/chat/unread-count', headers: authHeader(carolToken) })).json().count).toBe(1);
    await app.inject({ method: 'POST', url: `/chat/threads/${facilityId}/read`, headers: authHeader(aliceToken) });
    const unreadAfterAliceRead = (await app.inject({ method: 'GET', url: '/chat/threads', headers: authHeader(carolToken) })).json().threads.find((thread: { id: string }) => thread.id === facilityId).unreadCount;
    expect(unreadAfterAliceRead).toBe(1);
    expect((await app.inject({ method: 'GET', url: '/chat/unread-count', headers: authHeader(aliceToken) })).json().count).toBe(0);
    expect((await app.inject({ method: 'GET', url: '/chat/unread-count', headers: authHeader(bobToken) })).json().count).toBe(0);
    expect((await app.inject({ method: 'GET', url: '/chat/threads', headers: authHeader(platformToken) })).json().threads).toHaveLength(0);
    expect((await app.inject({ method: 'POST', url: `/chat/threads/${facilityId}/messages`, headers: authHeader(platformToken), payload: { body: 'Platform admin should not see staff room' } })).statusCode).toBe(404);

    const roleRoom = await app.inject({ method: 'POST', url: '/chat/groups', headers: authHeader(aliceToken), payload: { groupType: 'ROLE', groupRole: 'DOCTOR' } });
    const roleId = roleRoom.json().thread.id;
    expect((await app.inject({ method: 'GET', url: `/chat/threads/${roleId}/messages`, headers: authHeader(carolToken) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/chat/threads/${roleId}/messages`, headers: authHeader(bobToken) })).statusCode).toBe(404);

    const custom = await app.inject({ method: 'POST', url: '/chat/groups', headers: authHeader(aliceToken), payload: { groupType: 'CUSTOM', name: 'Outreach team', memberIds: [carol.id] } });
    const customId = custom.json().thread.id;
    expect((await app.inject({ method: 'GET', url: `/chat/threads/${customId}/messages`, headers: authHeader(carolToken) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/chat/threads/${customId}/messages`, headers: authHeader(bobToken) })).statusCode).toBe(404);

    await app.inject({ method: 'POST', url: `/chat/threads/${facilityId}/pin`, headers: authHeader(aliceToken), payload: { pinned: true } });
    const aliceThreads = (await app.inject({ method: 'GET', url: '/chat/threads', headers: authHeader(aliceToken) })).json().threads;
    const bobThreads = (await app.inject({ method: 'GET', url: '/chat/threads', headers: authHeader(bobToken) })).json().threads;
    expect(aliceThreads.find((thread: { id: string }) => thread.id === facilityId).isPinned).toBe(true);
    expect(bobThreads.find((thread: { id: string }) => thread.id === facilityId).isPinned).toBe(false);
    expect((await app.inject({ method: 'POST', url: `/chat/threads/${facilityId}/messages`, headers: authHeader(aliceToken), payload: { body: 'file', attachments: ['document.pdf'] } })).statusCode).toBe(400);
  });

  it('allows portal chat only while a clinic link remains active', async () => {
    const { prisma } = await import('../src/lib/prisma');
    const clinicA = await seedClinic();
    const clinicB = await seedClinic();
    const { user: doctorA, password: passwordA } = await seedUser({ clinicId: clinicA.id, role: 'DOCTOR' });
    const { user: doctorB, password: passwordB } = await seedUser({ clinicId: clinicB.id, role: 'DOCTOR' });
    const doctorAToken = (await loginAs(app, doctorA.email, passwordA)).token;
    const doctorBToken = (await loginAs(app, doctorB.email, passwordB)).token;
    const createdPatient = await app.inject({ method: 'POST', url: '/patients', headers: authHeader(doctorAToken), payload: { name: 'Chat Patient', phone: '0700111222' } });
    const patientId = createdPatient.json().patient.id;
    const portalAccount = await app.inject({ method: 'POST', url: `/patients/${patientId}/portal-account`, headers: authHeader(doctorAToken), payload: { phone: '0700111222', email: 'chat-patient@example.com' } });
    const setPasswordToken = new URL(portalAccount.json().devSetPasswordUrl).searchParams.get('token')!;
    await app.inject({ method: 'POST', url: '/patient-auth/set-password', payload: { token: setPasswordToken, password: 'PatientPass123!', phone: '0700111222' } });
    const login = await app.inject({ method: 'POST', url: '/patient-auth/login', payload: { identifier: 'chat-patient@example.com', password: 'PatientPass123!' } });
    const patientToken = login.json().token as string;
    const account = await prisma.patientAccount.findUniqueOrThrow({ where: { email: 'chat-patient@example.com' } });
    await prisma.patientAccessGrant.create({ data: { patientAccountId: account.id, clinicId: clinicB.id, method: 'PIN', grantedByUserId: doctorB.id } });

    const opened = await app.inject({ method: 'POST', url: '/patient-portal/chat/threads', headers: authHeader(patientToken), payload: { clinicId: clinicB.id } });
    expect(opened.statusCode).toBe(200);
    const threadId = opened.json().thread.id;
    expect((await app.inject({ method: 'POST', url: `/patient-portal/chat/threads/${threadId}/messages`, headers: authHeader(patientToken), payload: { body: 'No attachment', attachments: ['a.pdf'] } })).statusCode).toBe(400);
    const staffList = await app.inject({ method: 'GET', url: '/chat/patient-threads', headers: authHeader(doctorBToken) });
    expect(staffList.json().threads.map((thread: { id: string }) => thread.id)).toContain(threadId);
    expect((await app.inject({ method: 'POST', url: `/chat/patient-threads/${threadId}/messages`, headers: authHeader(doctorBToken), payload: { body: 'No attachment', attachment: 'a.pdf' } })).statusCode).toBe(400);
    await prisma.patientAccessGrant.updateMany({ where: { patientAccountId: account.id, clinicId: clinicB.id }, data: { revokedAt: new Date() } });
    expect((await app.inject({ method: 'GET', url: `/patient-portal/chat/threads/${threadId}/messages`, headers: authHeader(patientToken) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/chat/patient-threads/${threadId}/messages`, headers: authHeader(doctorBToken) })).statusCode).toBe(404);
  });
});
