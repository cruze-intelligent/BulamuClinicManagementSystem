import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

const HOUR = 60 * 60;

describe('staff sign-in sessions', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  const lifetimeHours = (token: string) => {
    const { iat, exp } = app.jwt.decode(token) as { iat: number; exp: number };
    return (exp - iat) / HOUR;
  };

  it('lasts a 12-hour shift, or 30 days with "Keep me signed in"', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });

    const shift = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: user.email, password } });
    expect(lifetimeHours(shift.json().token)).toBe(12);

    const remembered = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: user.email, password, remember: true } });
    expect(lifetimeHours(remembered.json().token)).toBe(30 * 24);

    // Anything but an explicit true is a normal session.
    const odd = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: user.email, password, remember: 'yes' } });
    expect(lifetimeHours(odd.json().token)).toBe(12);
  });

  it('ends every session when the password is changed - a 30-day one on a lost phone included', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'DOCTOR' });
    const remembered = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: user.email, password, remember: true } });
    const token = remembered.json().token;

    expect((await app.inject({ method: 'GET', url: `/patients/${clinic.id}`, headers: authHeader(token) })).statusCode).toBe(200);

    await prisma.user.update({ where: { id: user.id }, data: { password: await bcrypt.hash('a-new-password-123', 10) } });

    const after = await app.inject({ method: 'GET', url: `/patients/${clinic.id}`, headers: authHeader(token) });
    expect(after.statusCode).toBe(401);
    expect(after.json().reason).toBe('SESSION_ENDED');

    // The new password works as normal.
    const fresh = await loginAs(app, user.email, 'a-new-password-123');
    expect((await app.inject({ method: 'GET', url: `/patients/${clinic.id}`, headers: authHeader(fresh.token) })).statusCode).toBe(200);
  });

  it('tells the app a session is over (so it goes to sign-in) for an invalid token or a deactivated account', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'STAFF' });
    const { token } = await loginAs(app, user.email, password);

    const garbage = await app.inject({ method: 'GET', url: `/patients/${clinic.id}`, headers: authHeader('not-a-token') });
    expect(garbage.statusCode).toBe(401);
    expect(garbage.json().reason).toBe('SESSION_ENDED');

    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    const deactivated = await app.inject({ method: 'GET', url: `/patients/${clinic.id}`, headers: authHeader(token) });
    expect(deactivated.statusCode).toBe(401);
    expect(deactivated.json().reason).toBe('SESSION_ENDED');
  });
});
