import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

describe('referral routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates a referral from the caller clinic to another facility', async () => {
    const hc2 = await seedClinic({ name: 'HC II', facilityType: 'HEALTH_CENTRE_II' });
    const hc3 = await seedClinic({ name: 'HC III', facilityType: 'HEALTH_CENTRE_III' });
    const { user: nurse, password } = await seedUser({ clinicId: hc2.id, role: 'NURSE' });
    const { token } = await loginAs(app, nurse.email, password);
    const patient = await prisma.patient.create({ data: { name: 'P', phone: '0700', clinicId: hc2.id } });

    const response = await app.inject({
      method: 'POST',
      url: '/referrals',
      headers: authHeader(token),
      payload: { patientId: patient.id, toClinicId: hc3.id, reason: 'Needs surgery' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().referral.fromClinicId).toBe(hc2.id);
    expect(response.json().referral.toClinicId).toBe(hc3.id);
  });

  it('rejects referring a patient the caller cannot access', async () => {
    const hc2 = await seedClinic({ name: 'HC II', facilityType: 'HEALTH_CENTRE_II' });
    const hc3 = await seedClinic({ name: 'HC III', facilityType: 'HEALTH_CENTRE_III' });
    const otherClinic = await seedClinic({ name: 'Other' });
    const foreignPatient = await prisma.patient.create({ data: { name: 'P', phone: '0700', clinicId: otherClinic.id } });
    const { user: nurse, password } = await seedUser({ clinicId: hc2.id, role: 'NURSE' });
    const { token } = await loginAs(app, nurse.email, password);

    const response = await app.inject({
      method: 'POST',
      url: '/referrals',
      headers: authHeader(token),
      payload: { patientId: foreignPatient.id, toClinicId: hc3.id, reason: 'X' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('lets the receiving facility see and accept a referral addressed to it', async () => {
    const hc2 = await seedClinic({ name: 'HC II', facilityType: 'HEALTH_CENTRE_II' });
    const hc3 = await seedClinic({ name: 'HC III', facilityType: 'HEALTH_CENTRE_III' });
    const patient = await prisma.patient.create({ data: { name: 'P', phone: '0700', clinicId: hc2.id } });
    const referral = await prisma.referral.create({
      data: { patientId: patient.id, fromClinicId: hc2.id, toClinicId: hc3.id, reason: 'X' },
    });

    const { user: receivingDoctor, password } = await seedUser({ clinicId: hc3.id, role: 'DOCTOR' });
    const { token } = await loginAs(app, receivingDoctor.email, password);

    const list = await app.inject({ method: 'GET', url: `/referrals/${hc3.id}`, headers: authHeader(token) });
    expect(list.json().referrals).toHaveLength(1);

    const accept = await app.inject({
      method: 'PATCH',
      url: `/referrals/${referral.id}/status`,
      headers: authHeader(token),
      payload: { status: 'ACCEPTED' },
    });
    expect(accept.statusCode).toBe(200);
    expect(accept.json().referral.status).toBe('ACCEPTED');
  });

  it('rejects a third-party facility from acting on a referral it is not party to', async () => {
    const hc2 = await seedClinic({ name: 'HC II', facilityType: 'HEALTH_CENTRE_II' });
    const hc3 = await seedClinic({ name: 'HC III', facilityType: 'HEALTH_CENTRE_III' });
    const unrelated = await seedClinic({ name: 'Unrelated' });
    const patient = await prisma.patient.create({ data: { name: 'P', phone: '0700', clinicId: hc2.id } });
    const referral = await prisma.referral.create({
      data: { patientId: patient.id, fromClinicId: hc2.id, toClinicId: hc3.id, reason: 'X' },
    });

    const { user, password } = await seedUser({ clinicId: unrelated.id, role: 'DOCTOR' });
    const { token } = await loginAs(app, user.email, password);

    const response = await app.inject({
      method: 'PATCH',
      url: `/referrals/${referral.id}/status`,
      headers: authHeader(token),
      payload: { status: 'ACCEPTED' },
    });
    expect(response.statusCode).toBe(403);
  });
});
