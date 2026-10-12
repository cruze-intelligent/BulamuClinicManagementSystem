import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

describe("a facility administrator managing the facility's staff", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  async function facility() {
    const clinic = await seedClinic({ name: 'Mbarara Clinic' });
    const admin = await seedUser({ clinicId: clinic.id, role: 'ADMIN', name: 'Grace Admin' });
    const { token } = await loginAs(app, admin.user.email, admin.password);
    return { clinic, admin: admin.user, token };
  }

  const patch = (token: string, url: string, payload?: object) =>
    app.inject({ method: 'PATCH', url, headers: authHeader(token), ...(payload ? { payload } : {}) });

  it("corrects a staff member's name, email and role - and never returns the password hash", async () => {
    const { clinic, token } = await facility();
    const nurse = await seedUser({ clinicId: clinic.id, role: 'NURSE', name: 'Nurse Opio' });

    const res = await patch(token, `/users/${nurse.user.id}`, { name: '  Sarah Opio ', email: 'sarah.opio@mbarara.ug', role: 'DOCTOR' });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ name: 'Sarah Opio', email: 'sarah.opio@mbarara.ug', role: 'DOCTOR' });
    expect(JSON.stringify(res.json())).not.toContain('password');

    const audit = await prisma.auditLog.findFirst({ where: { entity: 'User', recordId: nurse.user.id, action: 'UPDATE' } });
    expect(audit?.metadata).toMatchObject({ fields: ['name', 'email', 'role'], fromRole: 'NURSE', toRole: 'DOCTOR' });
  });

  it('takes a role change into effect at once - the old session ends and they sign in with the new role', async () => {
    const { clinic, token } = await facility();
    const doctor = await seedUser({ clinicId: clinic.id, role: 'DOCTOR' });
    const doctorSession = await loginAs(app, doctor.user.email, doctor.password);

    await patch(token, `/users/${doctor.user.id}`, { role: 'STAFF' });

    const old = await app.inject({ method: 'GET', url: `/patients/${clinic.id}`, headers: authHeader(doctorSession.token) });
    expect(old.statusCode).toBe(401);
    expect(old.json().reason).toBe('SESSION_ENDED');
    const again = await loginAs(app, doctor.user.email, doctor.password);
    expect(again.user.role).toBe('STAFF');
  });

  it('rejects a duplicate or invalid email, an empty name and a platform-administrator role', async () => {
    const { clinic, token } = await facility();
    const nurse = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const other = await seedUser({ clinicId: clinic.id, role: 'STAFF' });

    expect((await patch(token, `/users/${nurse.user.id}`, { email: other.user.email })).statusCode).toBe(409);
    expect((await patch(token, `/users/${nurse.user.id}`, { email: 'not-an-email' })).statusCode).toBe(400);
    expect((await patch(token, `/users/${nurse.user.id}`, { name: '   ' })).statusCode).toBe(400);
    expect((await patch(token, `/users/${nurse.user.id}`, { role: 'SUPER_ADMIN' })).statusCode).toBe(400);
  });

  it('never lets an admin lock themselves out or leave the facility without an active administrator', async () => {
    const { admin, token } = await facility();

    expect((await patch(token, `/users/${admin.id}`, { role: 'NURSE' })).statusCode).toBe(400);
    expect((await patch(token, `/users/${admin.id}/deactivate`)).statusCode).toBe(400);
    expect((await patch(token, `/users/${admin.id}/password`, { password: 'a-new-password' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: `/users/${admin.id}`, headers: authHeader(token) })).statusCode).toBe(400);
    // Editing their own name is fine.
    expect((await patch(token, `/users/${admin.id}`, { name: 'Grace N. Admin' })).statusCode).toBe(200);
  });

  it('lets one administrator change another (the facility always keeps an active administrator)', async () => {
    const { clinic, admin } = await facility();
    const second = await seedUser({ clinicId: clinic.id, role: 'ADMIN', name: 'Second Admin' });
    const secondToken = (await loginAs(app, second.user.email, second.password)).token;

    expect((await patch(secondToken, `/users/${admin.id}`, { role: 'DOCTOR' })).statusCode).toBe(200);
    // The second admin is now the only one - and can't step down or switch themselves off.
    expect((await patch(secondToken, `/users/${second.user.id}`, { role: 'NURSE' })).statusCode).toBe(400);
    expect((await patch(secondToken, `/users/${second.user.id}/deactivate`)).statusCode).toBe(400);
    expect(await prisma.user.count({ where: { clinicId: clinic.id, role: 'ADMIN', isActive: true } })).toBe(1);
  });

  it('deactivating ends their session at once; reactivating lets them back in', async () => {
    const { clinic, token } = await facility();
    const pharmacist = await seedUser({ clinicId: clinic.id, role: 'PHARMACIST' });
    const session = await loginAs(app, pharmacist.user.email, pharmacist.password);

    const off = await patch(token, `/users/${pharmacist.user.id}/deactivate`);
    expect(off.statusCode).toBe(200);
    expect(JSON.stringify(off.json())).not.toContain('password');
    expect((await app.inject({ method: 'GET', url: `/patients/${clinic.id}`, headers: authHeader(session.token) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/auth/login', payload: { email: pharmacist.user.email, password: pharmacist.password } })).statusCode).toBe(403);

    expect((await patch(token, `/users/${pharmacist.user.id}/activate`)).statusCode).toBe(200);
    expect((await loginAs(app, pharmacist.user.email, pharmacist.password)).token).toBeTruthy();
  });

  it('resets a forgotten password: old sessions end and the new password works', async () => {
    const { clinic, token } = await facility();
    const nurse = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const session = await loginAs(app, nurse.user.email, nurse.password);

    expect((await patch(token, `/users/${nurse.user.id}/password`, { password: 'short' })).statusCode).toBe(400);
    expect((await patch(token, `/users/${nurse.user.id}/password`, { password: 'new-password-2026' })).statusCode).toBe(200);

    expect((await app.inject({ method: 'GET', url: `/patients/${clinic.id}`, headers: authHeader(session.token) })).statusCode).toBe(401);
    expect((await loginAs(app, nurse.user.email, 'new-password-2026')).token).toBeTruthy();
  });

  it('deletes an account added by mistake, but keeps (and says so) one that has recorded work', async () => {
    const { clinic, token } = await facility();
    const mistake = await seedUser({ clinicId: clinic.id, role: 'STAFF', name: 'Wrong Person' });
    const worker = await seedUser({ clinicId: clinic.id, role: 'NURSE', name: 'Nurse Achen' });

    // The nurse registers a patient, so their name is on a record.
    const workerToken = (await loginAs(app, worker.user.email, worker.password)).token;
    await app.inject({ method: 'POST', url: '/patients', headers: authHeader(workerToken), payload: { name: 'P', phone: '0700000001', clinicId: clinic.id } });

    const gone = await app.inject({ method: 'DELETE', url: `/users/${mistake.user.id}`, headers: authHeader(token) });
    expect(gone.statusCode).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: mistake.user.id } })).toBeNull();

    const kept = await app.inject({ method: 'DELETE', url: `/users/${worker.user.id}`, headers: authHeader(token) });
    expect(kept.statusCode).toBe(409);
    expect(kept.json().reason).toBe('HAS_RECORDS');
    expect(kept.json().error).toMatch(/Deactivate it instead/);
    expect(await prisma.user.findUnique({ where: { id: worker.user.id } })).not.toBeNull();
  });

  it("only works inside the admin's own facility, and never on a platform administrator", async () => {
    const { token } = await facility();
    const elsewhere = await seedClinic({ name: 'Other Clinic' });
    const theirNurse = await seedUser({ clinicId: elsewhere.id, role: 'NURSE' });
    const hq = await seedClinic({ name: 'Bulamu HQ' });
    const operator = await seedUser({ clinicId: hq.id, role: 'SUPER_ADMIN' });

    for (const target of [theirNurse.user.id, operator.user.id]) {
      expect((await patch(token, `/users/${target}`, { name: 'Hijacked' })).statusCode).toBe(403);
      expect((await patch(token, `/users/${target}/password`, { password: 'hijacked-password' })).statusCode).toBe(403);
      expect((await patch(token, `/users/${target}/deactivate`)).statusCode).toBe(403);
      expect((await app.inject({ method: 'DELETE', url: `/users/${target}`, headers: authHeader(token) })).statusCode).toBe(403);
    }
    expect((await prisma.user.findUnique({ where: { id: theirNurse.user.id } }))?.name).not.toBe('Hijacked');
  });

  it('is for administrators only', async () => {
    const { clinic } = await facility();
    const doctor = await seedUser({ clinicId: clinic.id, role: 'DOCTOR' });
    const nurse = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const doctorToken = (await loginAs(app, doctor.user.email, doctor.password)).token;

    expect((await patch(doctorToken, `/users/${nurse.user.id}`, { role: 'ADMIN' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/users/${nurse.user.id}`, headers: authHeader(doctorToken) })).statusCode).toBe(403);
  });

  it('checks a new account: a real email and a password of at least 8 characters', async () => {
    const { clinic, token } = await facility();
    const add = (payload: object) => app.inject({ method: 'POST', url: '/users', headers: authHeader(token), payload: { clinicId: clinic.id, role: 'NURSE', name: 'New Nurse', ...payload } });

    expect((await add({ email: 'nurse@mbarara.ug', password: 'short' })).statusCode).toBe(400);
    expect((await add({ email: 'nope', password: 'long-enough-1' })).statusCode).toBe(400);
    expect((await add({ email: 'admin2@mbarara.ug', password: 'long-enough-1', role: 'ADMIN' })).statusCode).toBe(200);
  });
});
