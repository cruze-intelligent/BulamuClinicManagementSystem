import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

describe('dashboard routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns stats scoped to the caller clinic', async () => {
    const clinic = await seedClinic();
    await prisma.patient.create({ data: { name: 'A', phone: '0700', clinicId: clinic.id } });
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({ method: 'GET', url: `/dashboard/${clinic.id}`, headers: authHeader(token) });
    expect(response.statusCode).toBe(200);
    expect(response.json().stats.totalPatients).toBe(1);
  });

  it('rejects reading another clinic dashboard', async () => {
    const clinicA = await seedClinic({ name: 'A' });
    const clinicB = await seedClinic({ name: 'B' });
    const { user, password } = await seedUser({ clinicId: clinicA.id, role: 'ADMIN' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({ method: 'GET', url: `/dashboard/${clinicB.id}`, headers: authHeader(token) });
    expect(response.statusCode).toBe(403);
  });

  it('search/patients never leaks other-clinic patients even without a clinicId query param', async () => {
    const clinicA = await seedClinic({ name: 'A' });
    const clinicB = await seedClinic({ name: 'B' });
    await prisma.patient.create({ data: { name: 'Secret Patient', phone: '0700', clinicId: clinicB.id } });
    const { user, password } = await seedUser({ clinicId: clinicA.id, role: 'STAFF' });
    const { token } = await loginAs(app, user.email, password);

    // No clinicId query param supplied at all - regression guard for the
    // pre-fix bug where an omitted clinicId meant "search every clinic".
    const response = await app.inject({
      method: 'GET',
      url: `/search/patients?q=Secret`,
      headers: authHeader(token),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().patients).toHaveLength(0);
  });
});
