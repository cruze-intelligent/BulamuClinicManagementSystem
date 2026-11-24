import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { authHeader, buildTestApp, loginAs, seedClinic, seedUser } from './helpers';
import { resetDb } from './db';

 describe('in-app chat', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
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
    const adminAToken = (await loginAs(app, adminA.email, passwordA)).token;
    const adminBToken = (await loginAs(app, adminB.email, passwordB)).token;
    const superToken = (await loginAs(app, superAdmin.email, superPassword)).token;

    const first = await app.inject({ method: 'POST', url: '/chat/admin-support', headers: authHeader(adminAToken) });
    const second = await app.inject({ method: 'POST', url: '/chat/admin-support', headers: authHeader(adminBToken) });
    expect(first.statusCode).toBe(200);
    expect(second.json().thread.id).toBe(first.json().thread.id);
    const threadId = first.json().thread.id;
    expect((await app.inject({ method: 'POST', url: `/chat/threads/${threadId}/messages`, headers: authHeader(adminBToken), payload: { body: 'We need help' } })).statusCode).toBe(200);
    const inbox = await app.inject({ method: 'GET', url: '/chat/super-admin/threads', headers: authHeader(superToken) });
    expect(inbox.json().threads).toHaveLength(1);
    expect((await app.inject({ method: 'POST', url: `/chat/super-admin/threads/${threadId}/messages`, headers: authHeader(superToken), payload: { body: 'How can we help?' } })).statusCode).toBe(200);
    const replies = await app.inject({ method: 'GET', url: `/chat/threads/${threadId}/messages`, headers: authHeader(adminBToken) });
    expect(replies.json().messages.map((message: { body: string }) => message.body)).toContain('How can we help?');
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
    const staffList = await app.inject({ method: 'GET', url: '/chat/patient-threads', headers: authHeader(doctorBToken) });
    expect(staffList.json().threads.map((thread: { id: string }) => thread.id)).toContain(threadId);
    await prisma.patientAccessGrant.updateMany({ where: { patientAccountId: account.id, clinicId: clinicB.id }, data: { revokedAt: new Date() } });
    expect((await app.inject({ method: 'GET', url: `/patient-portal/chat/threads/${threadId}/messages`, headers: authHeader(patientToken) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/chat/patient-threads/${threadId}/messages`, headers: authHeader(doctorBToken) })).statusCode).toBe(404);
  });
});