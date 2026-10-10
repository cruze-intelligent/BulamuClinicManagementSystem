import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';
import { allowedTransition } from '../src/lib/referrals';

vi.setConfig({ testTimeout: 60_000 });

const sendMailMock = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/mailer')>();
  return { ...actual, sendMail: sendMailMock };
});

describe('who may move a referral where', () => {
  it('lets the receiver accept/decline a pending referral and complete an accepted one, and the sender cancel an open one', () => {
    expect(allowedTransition('receiver', 'PENDING', 'ACCEPTED')).toBe(true);
    expect(allowedTransition('receiver', 'PENDING', 'DECLINED')).toBe(true);
    expect(allowedTransition('receiver', 'ACCEPTED', 'COMPLETED')).toBe(true);
    expect(allowedTransition('receiver', 'PENDING', 'COMPLETED')).toBe(false);
    expect(allowedTransition('receiver', 'PENDING', 'CANCELLED')).toBe(false);
    expect(allowedTransition('sender', 'PENDING', 'CANCELLED')).toBe(true);
    expect(allowedTransition('sender', 'ACCEPTED', 'CANCELLED')).toBe(true);
    expect(allowedTransition('sender', 'COMPLETED', 'CANCELLED')).toBe(false);
    expect(allowedTransition('sender', 'PENDING', 'ACCEPTED')).toBe(false);
  });
});

describe('referral routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue({ sent: true });
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  async function staff(clinicId: string, role: 'ADMIN' | 'DOCTOR' | 'NURSE' | 'STAFF' | 'PHARMACIST', name?: string) {
    const { user, password } = await seedUser({ clinicId, role, name });
    return { id: user.id, token: (await loginAs(app, user.email, password)).token };
  }

  async function setup() {
    const hc2 = await seedClinic({ name: 'Kasangati HC II', facilityType: 'HEALTH_CENTRE_II', phone: '0701000001' });
    const hc4 = await seedClinic({ name: 'Mulago HC IV', facilityType: 'HEALTH_CENTRE_IV', phone: '0701000002' });
    const nurse = await staff(hc2.id, 'NURSE', 'Nurse Sarah');
    const sendingAdmin = await staff(hc2.id, 'ADMIN', 'Admin Hc2');
    const receivingDoctor = await staff(hc4.id, 'DOCTOR', 'Dr Okello');
    const patient = await prisma.patient.create({
      data: {
        name: 'Grace Nansubuga', phone: '0772000111', clinicId: hc2.id, sex: 'FEMALE', dateOfBirth: new Date('1990-05-01'),
        district: 'Wakiso', nextOfKinName: 'Paul', nextOfKinPhone: '0772000222',
        allergyStatus: 'KNOWN', allergies: [{ substance: 'Penicillin', reaction: 'Rash', severity: 'SEVERE' }],
      },
    });
    return { hc2, hc4, nurse, sendingAdmin, receivingDoctor, patient };
  }

  const refer = (token: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/referrals', headers: authHeader(token), payload });

  it('creates a referral with urgency and clinical summary, records consent, and audits it', async () => {
    const { hc2, hc4, nurse, patient } = await setup();
    const res = await refer(nurse.token, {
      patientId: patient.id, toClinicId: hc4.id, reason: 'Obstructed labour', urgency: 'EMERGENCY',
      clinicalSummary: 'G2P1 at term, in labour 18h, no progress.', consentConfirmed: true,
    });
    expect(res.statusCode).toBe(200);
    const referral = res.json().referral;
    expect(referral).toMatchObject({ fromClinicId: hc2.id, toClinicId: hc4.id, urgency: 'EMERGENCY', referredByUserId: nurse.id, status: 'PENDING' });
    expect(referral.consentRecordedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { entity: 'Referral', recordId: referral.id, action: 'CREATE' } })).toBe(1);

    // The receiving facility is told it is an emergency.
    const doctorInbox = await prisma.notification.findMany({ where: { clinicId: hc4.id, type: 'REFERRAL_RECEIVED' } });
    expect(doctorInbox[0].title).toBe('EMERGENCY referral received');
  });

  it('refuses a referral without the patient\'s recorded agreement, or without a reason', async () => {
    const { hc4, nurse, patient } = await setup();
    const noConsent = await refer(nurse.token, { patientId: patient.id, toClinicId: hc4.id, reason: 'X' });
    expect(noConsent.statusCode).toBe(400);
    expect(noConsent.json().error).toMatch(/patient agreed/);
    expect((await refer(nurse.token, { patientId: patient.id, toClinicId: hc4.id, reason: '  ', consentConfirmed: true })).statusCode).toBe(400);
    expect(await prisma.referral.count()).toBe(0);
  });

  it('only refers to real, approved, active facilities other than the patient\'s own', async () => {
    const { hc2, nurse, patient } = await setup();
    const hq = await seedClinic({ name: 'Bulamu HQ', phone: '0701000009' });
    await seedUser({ clinicId: hq.id, role: 'SUPER_ADMIN' });
    const pending = await seedClinic({ name: 'Pending', registrationStatus: 'PENDING', isActive: false, phone: '0701000010' });
    const suspended = await seedClinic({ name: 'Suspended', isActive: false, phone: '0701000011' });

    for (const toClinicId of [hc2.id, hq.id, pending.id, suspended.id, 'no-such-clinic']) {
      const res = await refer(nurse.token, { patientId: patient.id, toClinicId, reason: 'X', consentConfirmed: true });
      expect(res.statusCode, toClinicId).toBeGreaterThanOrEqual(400);
    }
    expect(await prisma.referral.count()).toBe(0);
  });

  it('rejects referring a patient the caller cannot access, and roles that do not refer', async () => {
    const { hc4, patient } = await setup();
    const other = await seedClinic({ name: 'Other', phone: '0701000012' });
    const outsider = await staff(other.id, 'NURSE');
    expect((await refer(outsider.token, { patientId: patient.id, toClinicId: hc4.id, reason: 'X', consentConfirmed: true })).statusCode).toBe(403);

    const pharmacist = await staff(patient.clinicId, 'PHARMACIST');
    expect((await refer(pharmacist.token, { patientId: patient.id, toClinicId: hc4.id, reason: 'X', consentConfirmed: true })).statusCode).toBe(403);
  });

  it('runs the reply loop: the receiver accepts or declines, and the referring clinician and admin hear about it', async () => {
    const { hc2, hc4, nurse, sendingAdmin, receivingDoctor, patient } = await setup();
    const otherNurse = await staff(hc2.id, 'NURSE');
    const id = (await refer(nurse.token, { patientId: patient.id, toClinicId: hc4.id, reason: 'Needs surgery', consentConfirmed: true })).json().referral.id;
    const setStatus = (token: string, status: string, note?: string) =>
      app.inject({ method: 'PATCH', url: `/referrals/${id}/status`, headers: authHeader(token), payload: { status, note } });

    // The sender cannot accept its own referral; the receiver cannot complete before accepting.
    expect((await setStatus(nurse.token, 'ACCEPTED')).statusCode).toBe(409);
    expect((await setStatus(receivingDoctor.token, 'COMPLETED')).statusCode).toBe(409);

    const accepted = await setStatus(receivingDoctor.token, 'ACCEPTED', 'Theatre booked for this afternoon');
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().referral).toMatchObject({ status: 'ACCEPTED', respondedByUserId: receivingDoctor.id, responseNote: 'Theatre booked for this afternoon' });

    const told = await prisma.notification.findMany({ where: { type: 'REFERRAL_UPDATED' } });
    expect(told.map((n) => n.userId).sort()).toEqual([nurse.id, sendingAdmin.id].sort());
    expect(told[0].body).toContain('Theatre booked');
    expect(await prisma.notification.count({ where: { userId: otherNurse.id } })).toBe(0);

    expect((await setStatus(receivingDoctor.token, 'COMPLETED')).json().referral.status).toBe('COMPLETED');
    expect(await prisma.auditLog.count({ where: { entity: 'Referral', recordId: id, action: 'UPDATE' } })).toBe(2);
  });

  it('requires a reason to decline, and lets the sender cancel - telling the receiver', async () => {
    const { hc4, nurse, receivingDoctor, patient } = await setup();
    const first = (await refer(nurse.token, { patientId: patient.id, toClinicId: hc4.id, reason: 'A', consentConfirmed: true })).json().referral.id;
    const declineNoReason = await app.inject({ method: 'PATCH', url: `/referrals/${first}/status`, headers: authHeader(receivingDoctor.token), payload: { status: 'DECLINED' } });
    expect(declineNoReason.statusCode).toBe(400);
    const declined = await app.inject({ method: 'PATCH', url: `/referrals/${first}/status`, headers: authHeader(receivingDoctor.token), payload: { status: 'DECLINED', note: 'No surgeon until Monday - try Mengo' } });
    expect(declined.json().referral.status).toBe('DECLINED');

    const second = (await refer(nurse.token, { patientId: patient.id, toClinicId: hc4.id, reason: 'B', consentConfirmed: true })).json().referral.id;
    await prisma.notification.deleteMany();
    const cancel = await app.inject({ method: 'PATCH', url: `/referrals/${second}/status`, headers: authHeader(nurse.token), payload: { status: 'CANCELLED' } });
    expect(cancel.json().referral.status).toBe('CANCELLED');
    expect((await prisma.notification.findMany({ where: { userId: receivingDoctor.id } }))[0].title).toContain('Referral cancelled');
  });

  it('rejects a third-party facility from acting on a referral it is not party to', async () => {
    const { hc4, nurse, patient } = await setup();
    const id = (await refer(nurse.token, { patientId: patient.id, toClinicId: hc4.id, reason: 'X', consentConfirmed: true })).json().referral.id;
    const unrelated = await seedClinic({ name: 'Unrelated', phone: '0701000013' });
    const outsider = await staff(unrelated.id, 'DOCTOR');
    expect((await app.inject({ method: 'PATCH', url: `/referrals/${id}/status`, headers: authHeader(outsider.token), payload: { status: 'ACCEPTED' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/referrals/${id}/letter`, headers: authHeader(outsider.token) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/referrals/${id}/register-patient`, headers: authHeader(outsider.token) })).statusCode).toBe(403);
  });

  it('shows the receiver the patient\'s details, allergies and summary - but front desk staff not the clinical summary', async () => {
    const { hc4, nurse, receivingDoctor, patient } = await setup();
    await refer(nurse.token, { patientId: patient.id, toClinicId: hc4.id, reason: 'X', clinicalSummary: 'Confidential findings', consentConfirmed: true });

    const doctorView = (await app.inject({ method: 'GET', url: `/referrals/${hc4.id}`, headers: authHeader(receivingDoctor.token) })).json().referrals[0];
    expect(doctorView).toMatchObject({ direction: 'RECEIVED', clinicalSummary: 'Confidential findings', referredBy: 'Nurse Sarah' });
    expect(doctorView.patient.allergies).toContain('Penicillin');
    expect(doctorView.patient.sexAge).toMatch(/years, Female/);
    expect(doctorView.patient.nextOfKin).toBe('Paul - 0772000222');

    const frontDesk = await staff(hc4.id, 'STAFF');
    const deskView = (await app.inject({ method: 'GET', url: `/referrals/${hc4.id}`, headers: authHeader(frontDesk.token) })).json().referrals[0];
    expect(deskView.clinicalSummary).toBeNull();
    expect(deskView.patient.allergies).toBeNull();
    expect(deskView.patient.name).toBe('Grace Nansubuga');
  });

  it('lets the receiving facility register the referred patient once - demographics and allergies, not clinical history', async () => {
    const { hc2, hc4, nurse, patient } = await setup();
    await prisma.patient.update({ where: { id: patient.id }, data: { email: 'grace@example.com' } });
    const appt = await prisma.appointment.create({ data: { patientId: patient.id, doctorId: nurse.id, clinicId: hc2.id, date: new Date(), time: '09:00' } });
    await prisma.consultation.create({ data: { appointmentId: appt.id, patientId: patient.id, diagnosis: 'Secret dx', symptoms: 'x' } });
    const id = (await refer(nurse.token, { patientId: patient.id, toClinicId: hc4.id, reason: 'X', consentConfirmed: true })).json().referral.id;

    const frontDesk = await staff(hc4.id, 'STAFF');
    const first = await app.inject({ method: 'POST', url: `/referrals/${id}/register-patient`, headers: authHeader(frontDesk.token) });
    expect(first.statusCode).toBe(200);
    const registered = first.json().patient;
    expect(registered).toMatchObject({ clinicId: hc4.id, name: 'Grace Nansubuga', phone: '0772000111', district: 'Wakiso', allergyStatus: 'KNOWN', email: null, patientAccountId: null });
    expect(await prisma.consultation.count({ where: { patientId: registered.id } })).toBe(0);

    const again = await app.inject({ method: 'POST', url: `/referrals/${id}/register-patient`, headers: authHeader(frontDesk.token) });
    expect(again.json()).toMatchObject({ created: false, patient: { id: registered.id } });
    expect(await prisma.patient.count({ where: { clinicId: hc4.id } })).toBe(1);
  });

  it('prints the referral letter for both facilities', async () => {
    const { hc4, nurse, receivingDoctor, patient } = await setup();
    const id = (await refer(nurse.token, { patientId: patient.id, toClinicId: hc4.id, reason: 'X', urgency: 'URGENT', consentConfirmed: true })).json().referral.id;
    for (const token of [nurse.token, receivingDoctor.token]) {
      const pdf = await app.inject({ method: 'GET', url: `/referrals/${id}/letter`, headers: authHeader(token) });
      expect(pdf.statusCode).toBe(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    }
  });
});
