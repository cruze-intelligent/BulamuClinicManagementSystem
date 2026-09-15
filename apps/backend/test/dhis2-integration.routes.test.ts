import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

describe('DHIS2 integration routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lets ADMIN configure DHIS2 credentials and never echoes the password back', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({
      method: 'PUT',
      url: `/clinics/${clinic.id}/dhis2-integration`,
      headers: authHeader(token),
      payload: {
        baseUrl: 'https://dhis2.example.ug',
        username: 'bulamu',
        password: 'super-secret',
        orgUnitId: 'ORG_1',
        dataElementMap: { 'section1_attendance.totalOutpatients': 'DE_1' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().integration.encryptedPassword).toBeUndefined();

    const stored = await prisma.dhis2Integration.findUnique({ where: { clinicId: clinic.id } });
    expect(stored?.encryptedPassword).not.toContain('super-secret');
  });

  it('rejects the push endpoint when no integration is configured yet', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({
      method: 'POST',
      url: `/reports/hmis-105/${clinic.id}/push-dhis2`,
      headers: authHeader(token),
    });
    expect(response.statusCode).toBe(400);
  });

  it('pushes the mapped HMIS figures to the configured DHIS2 endpoint', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
    const { token } = await loginAs(app, user.email, password);

    await app.inject({
      method: 'PUT',
      url: `/clinics/${clinic.id}/dhis2-integration`,
      headers: authHeader(token),
      payload: {
        baseUrl: 'https://dhis2.example.ug',
        username: 'bulamu',
        password: 'super-secret',
        orgUnitId: 'ORG_1',
        dataElementMap: { 'section1_attendance.totalOutpatients': 'DE_1' },
      },
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'SUCCESS' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await app.inject({
      method: 'POST',
      url: `/reports/hmis-105/${clinic.id}/push-dhis2`,
      headers: authHeader(token),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://dhis2.example.ug/api/dataValueSets',
      expect.objectContaining({ method: 'POST' })
    );

    const stored = await prisma.dhis2Integration.findUnique({ where: { clinicId: clinic.id } });
    expect(stored?.lastPushedAt).not.toBeNull();
  });

  it('rejects a non-admin from configuring or pushing DHIS2 integration', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({
      method: 'PUT',
      url: `/clinics/${clinic.id}/dhis2-integration`,
      headers: authHeader(token),
      payload: { baseUrl: 'x', username: 'x', password: 'x', orgUnitId: 'x' },
    });
    expect(response.statusCode).toBe(403);
  });
});
