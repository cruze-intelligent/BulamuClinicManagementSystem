import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';

describe('clinic (super-admin) routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lets SUPER_ADMIN view the God Mode overview', async () => {
    const hq = await seedClinic({ name: 'HQ' });
    const { user, password } = await seedUser({ clinicId: hq.id, role: 'SUPER_ADMIN' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({ method: 'GET', url: '/super-admin/overview', headers: authHeader(token) });
    expect(response.statusCode).toBe(200);
  });

  it('rejects a non-super-admin from God Mode routes', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({ method: 'GET', url: '/super-admin/overview', headers: authHeader(token) });
    expect(response.statusCode).toBe(403);
  });
});
