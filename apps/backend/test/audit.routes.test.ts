import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

describe('audit and sync-conflict routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('records an audit entry when a patient is created and an ADMIN can read it', async () => {
    const clinic = await seedClinic();
    const { user: staff, password } = await seedUser({ clinicId: clinic.id, role: 'STAFF' });
    const { token: staffToken } = await loginAs(app, staff.email, password);

    await app.inject({
      method: 'POST',
      url: '/patients',
      headers: authHeader(staffToken),
      payload: { name: 'Audited Patient', phone: '0700', clinicId: clinic.id },
    });

    const { user: admin, password: adminPassword } = await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
    const { token: adminToken } = await loginAs(app, admin.email, adminPassword);

    const response = await app.inject({ method: 'GET', url: `/audit-log/${clinic.id}`, headers: authHeader(adminToken) });
    expect(response.statusCode).toBe(200);
    const entries = response.json().entries;
    expect(entries.some((e: any) => e.entity === 'Patient' && e.action === 'CREATE')).toBe(true);
  });

  it('rejects STAFF from reading the audit log', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'STAFF' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({ method: 'GET', url: `/audit-log/${clinic.id}`, headers: authHeader(token) });
    expect(response.statusCode).toBe(403);
  });

  it('logs a sync conflict when an older mutation arrives after a newer one already synced', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'STAFF' });
    const { token } = await loginAs(app, user.email, password);

    const newer = new Date('2026-01-10T12:00:00Z');
    const older = new Date('2026-01-10T08:00:00Z');

    await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: authHeader(token),
      payload: {
        operations: [
          { id: 'mut-newer', entity: 'patient', clinicId: clinic.id, payload: { id: 'pat-conflict', name: 'Newer Name', phone: '0700', clinicId: clinic.id, updatedAt: newer.toISOString() } },
        ],
      },
    });

    const staleResponse = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: authHeader(token),
      payload: {
        operations: [
          { id: 'mut-older', entity: 'patient', clinicId: clinic.id, payload: { id: 'pat-conflict', name: 'Stale Name', phone: '0700', clinicId: clinic.id, updatedAt: older.toISOString() } },
        ],
      },
    });

    // Stale mutation is not applied
    expect(staleResponse.json().applied).toHaveLength(0);

    const patient = await prisma.patient.findUnique({ where: { id: 'pat-conflict' } });
    expect(patient?.name).toBe('Newer Name');

    const { user: admin, password: adminPassword } = await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
    const { token: adminToken } = await loginAs(app, admin.email, adminPassword);

    const conflicts = await app.inject({ method: 'GET', url: `/sync-conflicts/${clinic.id}`, headers: authHeader(adminToken) });
    expect(conflicts.json().conflicts).toHaveLength(1);
    expect(conflicts.json().conflicts[0].recordId).toBe('pat-conflict');
  });

  it('soft-deletes a patient via a delete mutation (tombstone) instead of removing the row', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'STAFF' });
    const { token } = await loginAs(app, user.email, password);

    const patient = await prisma.patient.create({ data: { name: 'To Delete', phone: '0700', clinicId: clinic.id } });

    const response = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: authHeader(token),
      payload: {
        operations: [
          { id: 'mut-del', entity: 'patient', action: 'delete', clinicId: clinic.id, payload: { id: patient.id } },
        ],
      },
    });

    expect(response.json().applied).toHaveLength(1);

    const stillInDb = await prisma.patient.findUnique({ where: { id: patient.id } });
    expect(stillInDb).not.toBeNull();
    expect(stillInDb?.deletedAt).not.toBeNull();

    const list = await app.inject({ method: 'GET', url: `/patients/${clinic.id}`, headers: authHeader(token) });
    expect(list.json().patients.find((p: any) => p.id === patient.id)).toBeUndefined();
  });
});

describe('audit log export', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  async function seedActivity() {
    const hq = await seedClinic({ name: 'HQ' });
    const { user: superAdmin, password: superAdminPassword } = await seedUser({ clinicId: hq.id, role: 'SUPER_ADMIN' });
    const { token: superAdminToken } = await loginAs(app, superAdmin.email, superAdminPassword);

    const clinic = await seedClinic({ name: 'Export Clinic' });
    const { user: nurse, password: nursePassword } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const { user: doctor, password: doctorPassword } = await seedUser({ clinicId: clinic.id, role: 'DOCTOR' });
    const { token: nurseToken } = await loginAs(app, nurse.email, nursePassword);
    const { token: doctorToken } = await loginAs(app, doctor.email, doctorPassword);
    const { user: admin, password: adminPassword } = await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
    const { token: adminToken } = await loginAs(app, admin.email, adminPassword);

    await app.inject({ method: 'POST', url: '/patients', headers: authHeader(nurseToken), payload: { name: 'Nurse Patient', phone: '0700', clinicId: clinic.id } });
    await app.inject({ method: 'POST', url: '/patients', headers: authHeader(doctorToken), payload: { name: 'Doctor Patient', phone: '0701', clinicId: clinic.id } });

    return { clinic, nurse, doctor, admin, nurseToken, doctorToken, adminToken, superAdminToken };
  }

  it('resolves each entry to a readable actor name, and filters the platform feed to one actor', async () => {
    const { clinic, nurse, superAdminToken } = await seedActivity();

    const all = await app.inject({ method: 'GET', url: '/audit-log', headers: authHeader(superAdminToken) });
    expect(all.statusCode).toBe(200);
    const nurseEntry = all.json().entries.find((e: any) => e.actorUserId === nurse.id);
    expect(nurseEntry.actorName).toContain(nurse.name);
    expect(nurseEntry.clinicName).toContain(clinic.name);

    const filtered = await app.inject({ method: 'GET', url: `/audit-log?actorUserId=${nurse.id}`, headers: authHeader(superAdminToken) });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().entries.length).toBeGreaterThan(0);
    expect(filtered.json().entries.every((e: any) => e.actorUserId === nurse.id)).toBe(true);
  });

  it('downloads the whole platform activity as CSV, and a single actor\'s activity when filtered', async () => {
    const { nurse, superAdminToken } = await seedActivity();

    const whole = await app.inject({ method: 'GET', url: '/audit-log/export', headers: authHeader(superAdminToken) });
    expect(whole.statusCode).toBe(200);
    expect(whole.headers['content-type']).toContain('text/csv');
    expect(whole.headers['content-disposition']).toContain('attachment');
    expect(whole.body.split('\r\n')[0]).toContain('Action'); // header row present
    expect(whole.body).toContain(nurse.name);

    const forNurse = await app.inject({ method: 'GET', url: `/audit-log/export?actorUserId=${nurse.id}`, headers: authHeader(superAdminToken) });
    expect(forNurse.statusCode).toBe(200);
    const rows = forNurse.body.trim().split('\r\n');
    expect(rows.length).toBeGreaterThan(1); // header + at least one entry
    expect(rows.slice(1).every((row) => row.includes(nurse.name))).toBe(true);
  });

  it('lets an ADMIN download their own facility\'s activity, filtered to one actor, but not another facility\'s', async () => {
    const { clinic, doctor, adminToken } = await seedActivity();

    const facilityExport = await app.inject({ method: 'GET', url: `/audit-log/${clinic.id}/export`, headers: authHeader(adminToken) });
    expect(facilityExport.statusCode).toBe(200);
    expect(facilityExport.body).toContain(clinic.name);

    const forDoctor = await app.inject({ method: 'GET', url: `/audit-log/${clinic.id}/export?actorUserId=${doctor.id}`, headers: authHeader(adminToken) });
    expect(forDoctor.statusCode).toBe(200);
    const rows = forDoctor.body.trim().split('\r\n');
    expect(rows.slice(1).every((row) => row.includes(doctor.name))).toBe(true);

    const otherClinic = await seedClinic({ name: 'Someone Else' });
    const deniedExport = await app.inject({ method: 'GET', url: `/audit-log/${otherClinic.id}/export`, headers: authHeader(adminToken) });
    expect(deniedExport.statusCode).toBe(403);
  });

  it('lets any authenticated role export just their own activity', async () => {
    const { nurseToken } = await seedActivity();

    const response = await app.inject({ method: 'GET', url: '/audit-log/me/export', headers: authHeader(nurseToken) });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    const rows = response.body.trim().split('\r\n');
    expect(rows.length).toBeGreaterThan(1);
  });

  it('rejects a non-super-admin from exporting the platform-wide feed', async () => {
    const { adminToken } = await seedActivity();
    const response = await app.inject({ method: 'GET', url: '/audit-log/export', headers: authHeader(adminToken) });
    expect(response.statusCode).toBe(403);
  });
});
