import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

describe('user routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lets an ADMIN create a staff account in their own clinic', async () => {
    const clinic = await seedClinic();
    const { user: admin, password } = await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
    const { token } = await loginAs(app, admin.email, password);

    const response = await app.inject({
      method: 'POST',
      url: '/users',
      headers: authHeader(token),
      payload: { email: 'nurse@x.ug', password: 'SomePassword1!', name: 'Nurse', role: 'NURSE', clinicId: clinic.id },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.role).toBe('NURSE');
  });

  it('rejects an ADMIN minting a SUPER_ADMIN account (privilege escalation regression)', async () => {
    const clinic = await seedClinic();
    const { user: admin, password } = await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
    const { token } = await loginAs(app, admin.email, password);

    const response = await app.inject({
      method: 'POST',
      url: '/users',
      headers: authHeader(token),
      payload: { email: 'evil@x.ug', password: 'SomePassword1!', name: 'Evil', role: 'SUPER_ADMIN', clinicId: clinic.id },
    });

    expect(response.statusCode).toBe(400);
    const created = await prisma.user.findUnique({ where: { email: 'evil@x.ug' } });
    expect(created).toBeNull();
  });

  it('rejects an ADMIN planting a user in another clinic', async () => {
    const clinicA = await seedClinic({ name: 'A' });
    const clinicB = await seedClinic({ name: 'B' });
    const { user: admin, password } = await seedUser({ clinicId: clinicA.id, role: 'ADMIN' });
    const { token } = await loginAs(app, admin.email, password);

    const response = await app.inject({
      method: 'POST',
      url: '/users',
      headers: authHeader(token),
      payload: { email: 'planted@x.ug', password: 'SomePassword1!', name: 'Planted', role: 'STAFF', clinicId: clinicB.id },
    });

    expect(response.statusCode).toBe(403);
  });

  it('rejects deactivating a SUPER_ADMIN account', async () => {
    const hq = await seedClinic({ name: 'HQ' });
    const { user: superAdmin } = await seedUser({ clinicId: hq.id, role: 'SUPER_ADMIN' });
    const { user: admin, password } = await seedUser({ clinicId: hq.id, role: 'ADMIN' });
    const { token } = await loginAs(app, admin.email, password);

    const response = await app.inject({
      method: 'PATCH',
      url: `/users/${superAdmin.id}/deactivate`,
      headers: authHeader(token),
    });

    expect(response.statusCode).toBe(403);
  });

  it('rejects an ADMIN deactivating a user from another clinic', async () => {
    const clinicA = await seedClinic({ name: 'A' });
    const clinicB = await seedClinic({ name: 'B' });
    const { user: staffB } = await seedUser({ clinicId: clinicB.id, role: 'STAFF' });
    const { user: adminA, password } = await seedUser({ clinicId: clinicA.id, role: 'ADMIN' });
    const { token } = await loginAs(app, adminA.email, password);

    const response = await app.inject({
      method: 'PATCH',
      url: `/users/${staffB.id}/deactivate`,
      headers: authHeader(token),
    });

    expect(response.statusCode).toBe(403);
    const stillActive = await prisma.user.findUnique({ where: { id: staffB.id } });
    expect(stillActive?.isActive).toBe(true);
  });
});
