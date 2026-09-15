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
