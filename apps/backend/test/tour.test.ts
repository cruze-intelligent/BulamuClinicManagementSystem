import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';

describe('the guided walkthrough', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('is offered on a user\'s first sign-in only - on any device - once they finish or skip it', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });

    const first = await loginAs(app, user.email, password);
    expect(first.user.tourCompletedAt).toBeNull();

    const done = await app.inject({ method: 'POST', url: '/users/me/tour-completed', headers: authHeader(first.token) });
    expect(done.statusCode).toBe(200);
    expect(done.json().tourCompletedAt).toBeTruthy();

    // Signing in again (say, on another phone) says it has been seen.
    const second = await loginAs(app, user.email, password);
    expect(second.user.tourCompletedAt).toBeTruthy();
    expect(second.user.password).toBeUndefined();
  });

  it('needs a signed-in user', async () => {
    expect((await app.inject({ method: 'POST', url: '/users/me/tour-completed' })).statusCode).toBe(401);
  });
});
