import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';

describe('patient routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lets staff register and list patients within their own clinic', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'STAFF' });
    const { token } = await loginAs(app, user.email, password);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/patients',
      headers: authHeader(token),
      payload: { name: 'Jane Mukasa', phone: '0756111222', clinicId: clinic.id, sex: 'FEMALE' },
    });
    expect(createResponse.statusCode).toBe(200);
    expect(createResponse.json().patient.sex).toBe('FEMALE');

    const listResponse = await app.inject({
      method: 'GET',
      url: `/patients/${clinic.id}`,
      headers: authHeader(token),
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().patients).toHaveLength(1);
  });

  it('rejects a request for another clinic patient list (cross-clinic isolation)', async () => {
    const clinicA = await seedClinic({ name: 'Clinic A' });
    const clinicB = await seedClinic({ name: 'Clinic B' });
    const { user, password } = await seedUser({ clinicId: clinicA.id, role: 'STAFF' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({
      method: 'GET',
      url: `/patients/${clinicB.id}`,
      headers: authHeader(token),
    });

    expect(response.statusCode).toBe(403);
  });

  it('rejects registering a patient under a clinic the caller does not belong to', async () => {
    const clinicA = await seedClinic({ name: 'Clinic A' });
    const clinicB = await seedClinic({ name: 'Clinic B' });
    const { user, password } = await seedUser({ clinicId: clinicA.id, role: 'STAFF' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({
      method: 'POST',
      url: '/patients',
      headers: authHeader(token),
      payload: { name: 'Injected Patient', phone: '0700000000', clinicId: clinicB.id },
    });

    expect(response.statusCode).toBe(403);
  });

  it('allows SUPER_ADMIN to read across clinics', async () => {
    const hq = await seedClinic({ name: 'Bulamu HQ' });
    const clinicB = await seedClinic({ name: 'Clinic B' });
    const { user, password } = await seedUser({ clinicId: hq.id, role: 'SUPER_ADMIN' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({
      method: 'GET',
      url: `/patients/${clinicB.id}`,
      headers: authHeader(token),
    });

    expect(response.statusCode).toBe(200);
  });

  it('rejects unauthenticated requests', async () => {
    const clinic = await seedClinic();
    const response = await app.inject({ method: 'GET', url: `/patients/${clinic.id}` });
    expect(response.statusCode).toBe(401);
  });
});
