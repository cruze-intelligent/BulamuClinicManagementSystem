import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp();
});
afterAll(async () => {
  await app?.close();
});
beforeEach(async () => {
  await resetDb();
});

async function staff(clinicId: string, role: 'ADMIN' | 'DOCTOR' | 'NURSE' | 'LAB_TECH' | 'STAFF') {
  const { user, password } = await seedUser({ clinicId, role });
  return { user, token: (await loginAs(app, user.email, password)).token };
}

describe("a person's other roles and the right to verify lab results", () => {
  it('the administrator gives them; they apply at once, without signing in again', async () => {
    const clinic = await seedClinic();
    const [admin, labTech, desk] = await Promise.all([staff(clinic.id, 'ADMIN'), staff(clinic.id, 'LAB_TECH'), staff(clinic.id, 'STAFF')]);
    const patient = await prisma.patient.create({ data: { name: 'Achieng Mary', phone: '0700', clinicId: clinic.id } });
    const test = await prisma.labTest.create({ data: { patientId: patient.id, testName: 'Malaria RDT', results: 'Positive', status: 'COMPLETED', orderedBy: 'Lab', completedAt: new Date() } });
    const verify = (token: string) => app.inject({ method: 'POST', url: `/lab/${test.id}/verify`, headers: authHeader(token) });
    const duties = (token: string, id: string, payload: unknown) => app.inject({ method: 'PUT', url: `/users/${id}/duties`, headers: authHeader(token), payload });

    // Before: the lab technician enters results but may not verify them, nor dispense.
    expect((await verify(labTech.token)).statusCode).toBe(403);
    const dispensing = () => app.inject({ method: 'GET', url: '/prescriptions', headers: authHeader(labTech.token) });
    expect((await dispensing()).statusCode).toBe(403);

    // Only the administrator sets duties, and never the administrator's own role.
    expect((await duties(desk.token, labTech.user.id, { extraRoles: ['NURSE'] })).statusCode).toBe(403);
    expect((await duties(admin.token, labTech.user.id, { extraRoles: ['ADMIN'] })).statusCode).toBe(400);

    expect((await duties(admin.token, labTech.user.id, { extraRoles: [], hiddenSections: ['not a path'] })).statusCode).toBe(400);
    const given = await duties(admin.token, labTech.user.id, { extraRoles: ['PHARMACIST', 'LAB_TECH'], canVerifyLab: true, hiddenSections: ['/inventory', '/dashboard'] });
    expect(given.statusCode).toBe(200);
    // Their own role is not repeated as an extra one.
    // The dashboard always stays in their menu.
    expect(given.json().user).toMatchObject({ extraRoles: ['PHARMACIST'], canVerifyLab: true, hiddenSections: ['/inventory'] });

    // Same session: now they verify, and work as a pharmacist too.
    expect((await verify(labTech.token)).statusCode).toBe(200);
    expect((await dispensing()).statusCode).toBe(200);

    // Their device learns of it at the next sync.
    const pull = await app.inject({ method: 'GET', url: `/sync/pull?clinicId=${clinic.id}&lastSyncedAt=${new Date(0).toISOString()}`, headers: authHeader(labTech.token) });
    expect(pull.json().me).toEqual({ extraRoles: ['PHARMACIST'], canVerifyLab: true, hiddenSections: ['/inventory'] });
    const list = await app.inject({ method: 'GET', url: `/users/${clinic.id}`, headers: authHeader(admin.token) });
    expect(list.json().users.find((u: any) => u.id === labTech.user.id)).toMatchObject({ extraRoles: ['PHARMACIST'], canVerifyLab: true, hiddenSections: ['/inventory'] });
  });
});
