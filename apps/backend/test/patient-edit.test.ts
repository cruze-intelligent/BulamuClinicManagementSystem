import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

describe("correcting and removing a patient's registration", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  async function signIn(clinicId: string, role: 'ADMIN' | 'DOCTOR' | 'NURSE' | 'STAFF' | 'PHARMACIST') {
    const { user, password } = await seedUser({ clinicId, role });
    return (await loginAs(app, user.email, password)).token;
  }

  const newPatient = (clinicId: string) =>
    prisma.patient.create({ data: { name: 'Test Patient', phone: '0700000000', clinicId, village: 'Kisenyi' } });

  it('front desk, nurses, doctors and admins can correct details; only what changed is recorded', async () => {
    const clinic = await seedClinic();
    const patient = await newPatient(clinic.id);

    for (const role of ['STAFF', 'NURSE', 'DOCTOR', 'ADMIN'] as const) {
      const token = await signIn(clinic.id, role);
      const res = await app.inject({ method: 'PATCH', url: `/patients/${patient.id}`, headers: authHeader(token), payload: { name: `Name by ${role}` } });
      expect(res.statusCode, role).toBe(200);
    }

    const token = await signIn(clinic.id, 'NURSE');
    const res = await app.inject({
      method: 'PATCH', url: `/patients/${patient.id}`, headers: authHeader(token),
      payload: { name: 'Achieng Mary', phone: ' 0772123456 ', sex: 'FEMALE', dateOfBirth: '1994-03-02', village: '', nextOfKinName: 'Okello John', email: 'Mary@Example.ug' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().patient).toMatchObject({ name: 'Achieng Mary', phone: '0772123456', sex: 'FEMALE', village: null, nextOfKinName: 'Okello John', email: 'mary@example.ug' });

    const audit = await prisma.auditLog.findFirst({ where: { entity: 'Patient', recordId: patient.id, action: 'UPDATE' }, orderBy: { createdAt: 'desc' } });
    expect((audit?.metadata as { fields: string[] }).fields.sort()).toEqual(['dateOfBirth', 'email', 'name', 'nextOfKinName', 'phone', 'sex', 'village']);
    // The audit says which fields changed - never the patient's details themselves.
    expect(JSON.stringify(audit?.metadata)).not.toContain('Achieng');
  });

  it('refuses a missing name or phone, a future birth date and a bad email', async () => {
    const clinic = await seedClinic();
    const patient = await newPatient(clinic.id);
    const token = await signIn(clinic.id, 'NURSE');
    const edit = (payload: object) => app.inject({ method: 'PATCH', url: `/patients/${patient.id}`, headers: authHeader(token), payload });

    expect((await edit({ name: '  ' })).statusCode).toBe(400);
    expect((await edit({ phone: '' })).statusCode).toBe(400);
    expect((await edit({ dateOfBirth: '2999-01-01' })).statusCode).toBe(400);
    expect((await edit({ email: 'not-an-email' })).statusCode).toBe(400);
    expect((await prisma.patient.findUnique({ where: { id: patient.id } }))?.name).toBe('Test Patient');
  });

  it("can't be done by a pharmacist, or by another facility", async () => {
    const clinic = await seedClinic();
    const other = await seedClinic({ name: 'Other' });
    const patient = await newPatient(clinic.id);

    const pharmacist = await signIn(clinic.id, 'PHARMACIST');
    const outsider = await signIn(other.id, 'ADMIN');
    expect((await app.inject({ method: 'PATCH', url: `/patients/${patient.id}`, headers: authHeader(pharmacist), payload: { name: 'X' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: `/patients/${patient.id}`, headers: authHeader(outsider), payload: { name: 'X' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/patients/${patient.id}`, headers: authHeader(outsider) })).statusCode).toBe(403);
  });

  it('only an admin deletes a patient; they leave every list and the record can no longer be edited', async () => {
    const clinic = await seedClinic();
    const patient = await newPatient(clinic.id);
    const nurse = await signIn(clinic.id, 'NURSE');
    const admin = await signIn(clinic.id, 'ADMIN');

    expect((await app.inject({ method: 'DELETE', url: `/patients/${patient.id}`, headers: authHeader(nurse) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/patients/${patient.id}`, headers: authHeader(admin) })).statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: `/patients/${clinic.id}`, headers: authHeader(admin) });
    expect(list.json().patients).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: `/patients/record/${patient.id}`, headers: authHeader(admin) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: `/patients/${patient.id}`, headers: authHeader(admin), payload: { name: 'X' } })).statusCode).toBe(404);
    // Kept (so it can be restored), not erased.
    expect((await prisma.patient.findUnique({ where: { id: patient.id } }))?.deletedAt).not.toBeNull();
  });
});

describe("the platform administrator's totals", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('count only real facilities and nothing deleted - not Bulamu HQ, removed facilities or deleted patients', async () => {
    const hq = await seedClinic({ name: 'Bulamu HQ' });
    const operator = await seedUser({ clinicId: hq.id, role: 'SUPER_ADMIN' });
    const real = await seedClinic({ name: 'Real Clinic' });
    const removed = await seedClinic({ name: 'Removed Test Facility' });
    await prisma.clinic.update({ where: { id: removed.id }, data: { deletedAt: new Date() } });

    await prisma.patient.create({ data: { name: 'Real', phone: '0700000001', clinicId: real.id } });
    await prisma.patient.create({ data: { name: 'Deleted', phone: '0700000002', clinicId: real.id, deletedAt: new Date() } });
    await prisma.patient.create({ data: { name: 'HQ test', phone: '0700000003', clinicId: hq.id } });
    await prisma.patient.create({ data: { name: 'Removed facility test', phone: '0700000004', clinicId: removed.id } });

    const { token } = await loginAs(app, operator.user.email, operator.password);
    const res = await app.inject({ method: 'GET', url: '/super-admin/overview', headers: authHeader(token) });
    expect(res.statusCode).toBe(200);
    const overview = res.json().overview;
    expect(overview.patientCount).toBe(1);
    expect(overview.clinics.map((c: any) => c.name)).toEqual(['Real Clinic']);
    expect(overview.clinics[0].patients).toBe(1);
  });
});
