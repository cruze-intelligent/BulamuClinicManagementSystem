import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

describe('inventory routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('adds and lists medicine within the caller clinic', async () => {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'PHARMACIST' });
    const { token } = await loginAs(app, user.email, password);

    const create = await app.inject({
      method: 'POST',
      url: '/inventory',
      headers: authHeader(token),
      payload: { clinicId: clinic.id, name: 'Paracetamol', quantity: 100, unit: 'tablets', reorderLevel: 20, price: 500 },
    });
    expect(create.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: `/inventory/${clinic.id}`, headers: authHeader(token) });
    expect(list.json().medicines).toHaveLength(1);
  });

  it('rejects adding medicine under another clinic', async () => {
    const clinicA = await seedClinic({ name: 'A' });
    const clinicB = await seedClinic({ name: 'B' });
    const { user, password } = await seedUser({ clinicId: clinicA.id, role: 'PHARMACIST' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({
      method: 'POST',
      url: '/inventory',
      headers: authHeader(token),
      payload: { clinicId: clinicB.id, name: 'Injected', quantity: 1, unit: 'unit', reorderLevel: 1, price: 1 },
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects updating quantity of another clinic medicine', async () => {
    const clinicA = await seedClinic({ name: 'A' });
    const clinicB = await seedClinic({ name: 'B' });
    const medicine = await prisma.medicine.create({
      data: { clinicId: clinicB.id, name: 'M', quantity: 10, unit: 'unit', reorderLevel: 2, price: 100 },
    });
    const { user, password } = await seedUser({ clinicId: clinicA.id, role: 'PHARMACIST' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({
      method: 'PATCH',
      url: `/inventory/${medicine.id}`,
      headers: authHeader(token),
      payload: { quantity: 0 },
    });
    expect(response.statusCode).toBe(403);

    const unchanged = await prisma.medicine.findUnique({ where: { id: medicine.id } });
    expect(unchanged?.quantity).toBe(10);
  });
});
