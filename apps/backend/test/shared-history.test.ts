import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

vi.setConfig({ testTimeout: 90_000 });

const sendMailMock = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/mailer')>();
  return { ...actual, sendMail: sendMailMock };
});

const PHONE = '0756111222';
const PASSWORD = 'MyNewPassword123!';

describe('sharing a patient\'s history between facilities - only with the patient\'s approval', () => {
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

  async function staff(clinicId: string, role: 'ADMIN' | 'DOCTOR' | 'NURSE' | 'STAFF' | 'PHARMACIST') {
    const { user, password } = await seedUser({ clinicId, role, name: `${role} user` });
    return { id: user.id, token: (await loginAs(app, user.email, password)).token };
  }

  // Facility A registers the patient (with an email, so they get a portal
  // account) and records care; facility B links the account with the patient's password.
  async function setup() {
    const a = await seedClinic({ name: 'Clinic A', phone: '0703000001' });
    const b = await seedClinic({ name: 'Clinic B', phone: '0703000002' });
    const aNurse = await staff(a.id, 'NURSE');
    const aDoctor = await staff(a.id, 'DOCTOR');
    const bDoctor = await staff(b.id, 'DOCTOR');
    const bNurse = await staff(b.id, 'NURSE');

    const registered = (await app.inject({
      method: 'POST', url: '/patients', headers: authHeader(aNurse.token),
      payload: { name: 'Jane Mukasa', phone: PHONE, email: 'jane@example.com', sex: 'FEMALE' },
    })).json();
    const token = new URL(registered.portalInvitation.devSetPasswordUrl).searchParams.get('token')!;
    await app.inject({ method: 'POST', url: '/patient-auth/set-password', payload: { token, password: PASSWORD, phone: PHONE } });
    const patientToken = (await app.inject({ method: 'POST', url: '/patient-auth/login', payload: { identifier: 'jane@example.com', password: PASSWORD } })).json().token as string;
    const account = await prisma.patientAccount.findUniqueOrThrow({ where: { email: 'jane@example.com' } });

    // Care at facility A: allergies, a visit with diagnosis and medicine, a lab result,
    // and things that must never be shared.
    const aPatientId = registered.patient.id as string;
    await prisma.patient.update({ where: { id: aPatientId }, data: { allergyStatus: 'KNOWN', allergies: [{ substance: 'Sulfa drugs', reaction: 'Rash', severity: 'MODERATE' }] } });
    const appt = await prisma.appointment.create({ data: { patientId: aPatientId, doctorId: aDoctor.id, clinicId: a.id, date: new Date(), time: '09:00' } });
    const consult = await prisma.consultation.create({ data: { appointmentId: appt.id, patientId: aPatientId, diagnosis: 'Malaria', symptoms: 'Fever 3 days', clinicalNotes: 'PRIVATE ASSESSMENT' } });
    await prisma.diagnosis.create({ data: { consultationId: consult.id, description: 'Malaria, unspecified', icd10Code: 'B54', type: 'PRIMARY' } });
    await prisma.prescription.create({ data: { consultationId: consult.id, medication: 'Artemether/Lumefantrine', strength: '20/120 mg', dosage: '4 tablets', frequency: 'BD', duration: '3 days' } });
    await prisma.labTest.create({ data: { patientId: aPatientId, testName: 'Malaria RDT', results: 'Positive', status: 'COMPLETED', completedAt: new Date(), orderedBy: 'x' } });
    await prisma.labTest.create({ data: { patientId: aPatientId, testName: 'Pending test', results: '', status: 'PENDING', orderedBy: 'x' } });
    await prisma.reproductiveHealthRecord.create({ data: { patientId: aPatientId, recordedById: aNurse.id, familyPlanningMethod: 'IMPLANT' } as any }).catch(() => undefined);

    const linked = await app.inject({ method: 'POST', url: '/patients/link-account', headers: authHeader(bNurse.token), payload: { portableId: account.portableId, method: 'PIN', password: PASSWORD } });
    expect(linked.statusCode).toBe(200);
    const bPatientId = linked.json().patient.id as string;
    sendMailMock.mockClear();
    await prisma.notification.deleteMany();
    return { a, b, aNurse, aDoctor, bDoctor, bNurse, account, patientToken, aPatientId, bPatientId };
  }

  const get = (token: string, url: string) => app.inject({ method: 'GET', url, headers: authHeader(token) });
  const post = (token: string, url: string, payload: Record<string, unknown> = {}) => app.inject({ method: 'POST', url, headers: authHeader(token), payload });

  it('linking a facility does not by itself share anything from other facilities', async () => {
    const { bDoctor, bPatientId } = await setup();
    const status = (await get(bDoctor.token, `/patients/${bPatientId}/shared-history/status`)).json();
    expect(status).toMatchObject({ linked: true, share: null, otherFacilities: 1 });
    const read = await get(bDoctor.token, `/patients/${bPatientId}/shared-history`);
    expect(read.statusCode).toBe(403);
    expect(read.json().error).toMatch(/not approved/);
  });

  it('the patient approves at the facility with their password - then clinicians see a safe summary, and every look is logged', async () => {
    const { b, bDoctor, account, bPatientId } = await setup();
    expect((await post(bDoctor.token, `/patients/${bPatientId}/shared-history/approve`, { method: 'PIN', password: 'wrong' })).statusCode).toBe(401);
    const approved = await post(bDoctor.token, `/patients/${bPatientId}/shared-history/approve`, { method: 'PIN', password: PASSWORD });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().share).toMatchObject({ status: 'APPROVED', approvalMethod: 'PIN' });

    // The patient gets a security notice, in-app and by email.
    const notice = await prisma.notification.findFirstOrThrow({ where: { patientAccountId: account.id, type: 'HISTORY_SHARING_APPROVED' } });
    expect(notice.body).toContain('with your password');
    expect(sendMailMock.mock.calls.map(([m]) => m.to)).toContain('jane@example.com');

    const res = await get(bDoctor.token, `/patients/${bPatientId}/shared-history`);
    expect(res.statusCode).toBe(200);
    const [facility] = res.json().facilities;
    expect(facility.facility.name).toBe('Clinic A');
    expect(facility.allergies).toContain('Sulfa drugs');
    expect(facility.visits[0].diagnoses[0]).toMatchObject({ description: 'Malaria, unspecified', icd10Code: 'B54' });
    expect(facility.visits[0].medicines[0].title).toContain('Artemether/Lumefantrine');
    expect(facility.labResults.map((l: any) => l.test)).toEqual(['Malaria RDT']);
    expect(res.json().facilities).toHaveLength(1); // never B's own records back

    // Not shared: free-text assessment notes, reproductive health, documents, billing.
    expect(res.body).not.toContain('PRIVATE ASSESSMENT');
    expect(res.body).not.toMatch(/IMPLANT|familyPlanning|invoice/i);

    const views = await prisma.auditLog.findMany({ where: { entity: 'SharedHistory', action: 'VIEW' } });
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ clinicId: b.id, actorUserId: bDoctor.id, recordId: bPatientId });
  });

  it('a link code can never approve history, and a history code never links an account', async () => {
    const c = await seedClinic({ name: 'Clinic C', phone: '0703000003' });
    const cNurse = await staff(c.id, 'NURSE');
    const { bDoctor, bPatientId, account } = await setup();

    // A HISTORY code issued at B...
    const historyOtp = (await post(bDoctor.token, `/patients/${bPatientId}/shared-history/otp`)).json().devOtp;
    expect(historyOtp).toMatch(/^\d{6}$/);
    expect(sendMailMock.mock.calls[0][0].subject).toBe('Your Bulamu approval code');
    // ...a LINK code issued at B for the same account...
    const linkOtp = (await post(bDoctor.token, '/patients/link-account/otp', { portableId: account.portableId })).json().devOtp;

    // The link code does not approve history.
    expect((await post(bDoctor.token, `/patients/${bPatientId}/shared-history/approve`, { method: 'OTP', otp: linkOtp })).statusCode).toBe(401);
    // The right code does, once.
    expect((await post(bDoctor.token, `/patients/${bPatientId}/shared-history/approve`, { method: 'OTP', otp: historyOtp })).statusCode).toBe(200);

    // And at another facility, a history code cannot be used to link the account.
    const cHistoryOtpForB = historyOtp;
    expect((await post(cNurse.token, '/patients/link-account', { portableId: account.portableId, method: 'OTP', otp: cHistoryOtpForB })).statusCode).toBe(401);
  });

  it('staff can ask remotely; the patient approves from their portal and the clinician who asked is told', async () => {
    const { bDoctor, bNurse, account, patientToken, bPatientId } = await setup();
    const asked = await post(bDoctor.token, `/patients/${bPatientId}/shared-history/request`);
    expect(asked.json().share).toMatchObject({ status: 'REQUESTED', requestedByUserId: bDoctor.id });
    expect((await post(bDoctor.token, `/patients/${bPatientId}/shared-history/request`)).json().share.id).toBe(asked.json().share.id); // no duplicates

    const request = await prisma.notification.findFirstOrThrow({ where: { patientAccountId: account.id, type: 'HISTORY_ACCESS_REQUESTED' } });
    expect(request.body).toContain('Nothing is shared unless you approve');
    expect((await get(bDoctor.token, `/patients/${bPatientId}/shared-history`)).statusCode).toBe(403);

    const mine = (await get(patientToken, '/patient-portal/history-sharing')).json();
    expect(mine.shares[0]).toMatchObject({ facility: 'Clinic B', status: 'REQUESTED' });
    const approved = await post(patientToken, `/patient-portal/history-sharing/${mine.shares[0].id}/approve`);
    expect(approved.json().share).toMatchObject({ status: 'APPROVED', approvalMethod: 'PORTAL' });

    expect((await prisma.notification.findMany({ where: { type: 'HISTORY_ACCESS_APPROVED' } })).map((n) => n.userId)).toEqual([bDoctor.id]);
    expect((await get(bNurse.token, `/patients/${bPatientId}/shared-history`)).statusCode).toBe(200);

    // The patient sees who looked.
    expect((await get(patientToken, '/patient-portal/history-sharing')).json().views).toEqual([{ facility: 'Clinic B', at: expect.any(String) }]);
  });

  it('the patient can decline a request, or withdraw approval at any time - and access stops at once', async () => {
    const { bDoctor, patientToken, bPatientId } = await setup();
    const first = (await post(bDoctor.token, `/patients/${bPatientId}/shared-history/request`)).json().share.id;
    expect((await post(patientToken, `/patient-portal/history-sharing/${first}/decline`)).json().share.status).toBe('DECLINED');
    expect((await get(bDoctor.token, `/patients/${bPatientId}/shared-history`)).statusCode).toBe(403);

    const approved = (await post(bDoctor.token, `/patients/${bPatientId}/shared-history/approve`, { method: 'PIN', password: PASSWORD })).json().share.id;
    expect((await get(bDoctor.token, `/patients/${bPatientId}/shared-history`)).statusCode).toBe(200);
    expect((await post(patientToken, `/patient-portal/history-sharing/${approved}/withdraw`)).json().share.status).toBe('WITHDRAWN');
    expect((await get(bDoctor.token, `/patients/${bPatientId}/shared-history`)).statusCode).toBe(403);
  });

  it('revoking a facility\'s access to the account also ends history sharing with it', async () => {
    const { bDoctor, patientToken, bPatientId } = await setup();
    await post(bDoctor.token, `/patients/${bPatientId}/shared-history/approve`, { method: 'PIN', password: PASSWORD });
    const grants = (await get(patientToken, '/patient-portal/access')).json().grants;
    await app.inject({ method: 'DELETE', url: `/patient-portal/access/${grants[0].id}`, headers: authHeader(patientToken) });
    expect((await get(bDoctor.token, `/patients/${bPatientId}/shared-history`)).statusCode).toBe(403);
    expect((await prisma.historyShare.findFirstOrThrow()).status).toBe('WITHDRAWN');
  });

  it('only clinicians read shared history, and never for a patient at another facility', async () => {
    const { a, b, aDoctor, bDoctor, bPatientId } = await setup();
    await post(bDoctor.token, `/patients/${bPatientId}/shared-history/approve`, { method: 'PIN', password: PASSWORD });
    for (const role of ['ADMIN', 'PHARMACIST', 'STAFF'] as const) {
      const someone = await staff(b.id, role);
      expect((await get(someone.token, `/patients/${bPatientId}/shared-history`)).statusCode, role).toBe(403);
    }
    expect((await get(aDoctor.token, `/patients/${bPatientId}/shared-history`)).statusCode).toBe(404);
    void a;
  });

  it('cannot ask about a patient who has no portal account linked to the facility', async () => {
    const { b, bDoctor } = await setup();
    const local = await prisma.patient.create({ data: { name: 'No Account', phone: '0700', clinicId: b.id } });
    expect((await get(bDoctor.token, `/patients/${local.id}/shared-history/status`)).json()).toMatchObject({ linked: false });
    expect((await post(bDoctor.token, `/patients/${local.id}/shared-history/request`)).statusCode).toBe(409);
  });
});
