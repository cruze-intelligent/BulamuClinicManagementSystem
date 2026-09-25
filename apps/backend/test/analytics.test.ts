import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';
import { changeFrom, engagementStatus, parseDays, periodRange } from '../src/lib/analytics';
import { eastAfricaDay, setUsageTrackingEnabled, trackUserActivity } from '../src/lib/usage-tracking';
import { LATENCY_EDGES_MS, percentileMs, recordRequest, resetRuntimeMetrics, snapshotRuntimeMetrics } from '../src/lib/runtime-metrics';

vi.setConfig({ testTimeout: 60_000 });

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

describe('period and status rules', () => {
  it('works in East Africa time: 21:30 UTC is already tomorrow in Kampala', () => {
    expect(eastAfricaDay(new Date('2026-09-26T20:59:00Z'))).toBe('2026-09-26');
    expect(eastAfricaDay(new Date('2026-09-26T21:00:00Z'))).toBe('2026-09-27');
    expect(eastAfricaDay(new Date('2026-12-31T22:00:00Z'))).toBe('2027-01-01');
  });

  it('builds the period ending today, and where the previous equal period starts', () => {
    const r = periodRange(30, new Date('2026-09-26T10:00:00Z'));
    expect(r.toDay).toBe('2026-09-26');
    expect(r.fromDay).toBe('2026-08-28'); // 30 days inclusive
    expect(r.fromTs.toISOString()).toBe('2026-08-27T21:00:00.000Z'); // 00:00 EAT
    expect(r.toTs.toISOString()).toBe('2026-09-26T21:00:00.000Z'); // start of the next EAT day
    expect(r.prevFromTs.toISOString()).toBe('2026-07-28T21:00:00.000Z');

    const week = periodRange(7, new Date('2026-09-26T10:00:00Z'));
    expect(week.fromDay).toBe('2026-09-20');
  });

  it('only offers 7, 30 and 90 day windows', () => {
    expect(parseDays('7')).toBe(7);
    expect(parseDays('90')).toBe(90);
    for (const bad of [undefined, '', '0', '15', '365', 'abc', '-30']) expect(parseDays(bad)).toBe(30);
  });

  it('rates a facility by when anything last happened there', () => {
    const now = new Date('2026-09-26T12:00:00Z');
    const created = new Date('2026-01-01T00:00:00Z');
    expect(engagementStatus(new Date(now.getTime() - 2 * DAY), created, now)).toBe('ACTIVE');
    expect(engagementStatus(new Date(now.getTime() - 7 * DAY), created, now)).toBe('ACTIVE');
    expect(engagementStatus(new Date(now.getTime() - 8 * DAY), created, now)).toBe('QUIET');
    expect(engagementStatus(new Date(now.getTime() - 30 * DAY), created, now)).toBe('QUIET');
    expect(engagementStatus(new Date(now.getTime() - 31 * DAY), created, now)).toBe('DORMANT');
    expect(engagementStatus(null, new Date(now.getTime() - 3 * DAY), now)).toBe('NEW');
    expect(engagementStatus(null, new Date(now.getTime() - 20 * DAY), now)).toBe('NEVER_USED');
  });

  it('expresses change against the previous period, and admits when there is no baseline', () => {
    expect(changeFrom(150, 100)).toBe(0.5);
    expect(changeFrom(50, 100)).toBe(-0.5);
    expect(changeFrom(0, 0)).toBe(0);
    expect(changeFrom(10, 0)).toBeNull();
  });
});

describe('request metrics', () => {
  beforeEach(() => resetRuntimeMetrics());

  it('counts requests and errors and reports response times from a histogram', () => {
    for (let i = 0; i < 90; i++) recordRequest({ method: 'GET', route: '/patients/:id', status: 200, ms: 30 });
    for (let i = 0; i < 8; i++) recordRequest({ method: 'GET', route: '/patients/:id', status: 200, ms: 400 });
    recordRequest({ method: 'POST', route: '/consultations', status: 500, ms: 3000 });
    recordRequest({ method: 'POST', route: '/consultations', status: 404, ms: 20 });

    const snap = snapshotRuntimeMetrics();
    expect(snap.sinceStart).toMatchObject({ requests: 100, serverErrors: 1, clientErrors: 1 });
    expect(snap.sinceStart.serverErrorRate).toBeCloseTo(0.01);
    expect(snap.sinceStart.p50).toEqual({ ms: 50, overflow: false });
    expect(snap.sinceStart.p95).toEqual({ ms: 500, overflow: false });
    expect(snap.lastHour.requests).toBe(100);
    expect(snap.lastHour.perMinute).toHaveLength(60);
    expect(snap.busiestRoutes[0]).toMatchObject({ route: 'GET /patients/:id', requests: 98 });
    expect(snap.erroringRoutes[0]).toMatchObject({ route: 'POST /consultations', errors: 1 });
    expect(snap.slowestRoutes.find((r) => r.route === 'POST /consultations')).toBeUndefined(); // too few requests to judge
  });

  it('reads percentiles from the buckets, and flags anything beyond the last edge', () => {
    const empty = new Array(LATENCY_EDGES_MS.length + 1).fill(0);
    expect(percentileMs(empty, 0.95)).toBeNull();
    const slow = [...empty]; slow[slow.length - 1] = 10;
    expect(percentileMs(slow, 0.5)).toEqual({ ms: 5000, overflow: true });
  });

  it('only keeps the last hour minute by minute, and lists no concrete URLs', () => {
    const now = Date.now();
    recordRequest({ method: 'GET', route: '/x', status: 200, ms: 10, at: now - 90 * 60_000 });
    recordRequest({ method: 'GET', route: '/x', status: 200, ms: 10, at: now });
    const snap = snapshotRuntimeMetrics(now);
    expect(snap.lastHour.requests).toBe(1);
    expect(snap.sinceStart.requests).toBe(2);
  });
});

describe('super admin analytics', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    resetRuntimeMetrics();
    setUsageTrackingEnabled(false);
    app = await buildTestApp();
  });

  afterAll(async () => {
    setUsageTrackingEnabled(false);
    await app?.close();
  });

  async function platform() {
    const hq = await seedClinic({ name: 'Bulamu HQ' });
    const { user: sa, password } = await seedUser({ clinicId: hq.id, role: 'SUPER_ADMIN', name: 'Sam Super' });
    const token = (await loginAs(app, sa.email, password)).token;
    return { hq, token, saId: sa.id };
  }

  async function facility(name: string, extra: { facilityType?: string; district?: string; createdAt?: Date } = {}) {
    const clinic = await seedClinic({ name, facilityType: extra.facilityType, phone: `07${Math.floor(10000000 + Math.random() * 89999999)}` });
    await prisma.clinic.update({ where: { id: clinic.id }, data: { district: extra.district ?? null, ...(extra.createdAt ? { createdAt: extra.createdAt } : {}) } });
    const admin = await seedUser({ clinicId: clinic.id, role: 'ADMIN', name: `${name} Admin` });
    const nurse = await seedUser({ clinicId: clinic.id, role: 'NURSE', name: `${name} Nurse` });
    return { clinic, admin: admin.user, nurse: nurse.user };
  }

  const get = (token: string, url: string) => app.inject({ method: 'GET', url, headers: authHeader(token) });

  it('is for the platform operator only', async () => {
    const { clinic } = await facility('Some Clinic');
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
    const token = (await loginAs(app, user.email, password)).token;
    for (const url of ['/super-admin/analytics', '/super-admin/system', '/super-admin/users', '/super-admin/analytics/export?dataset=facilities']) {
      expect((await get(token, url)).statusCode, url).toBe(403);
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(401);
    }
  });

  it('counts real facilities, staff, patients, consultations and revenue - and not the operator\'s own account', async () => {
    const { token } = await platform();
    const a = await facility('Kampala Clinic', { facilityType: 'HOSPITAL', district: 'Kampala' });
    const b = await facility('Mbale Lab', { facilityType: 'LABORATORY', district: 'Mbale' });
    await seedClinic({ name: 'Waiting Clinic', registrationStatus: 'PENDING', isActive: false });

    // Patients: 3 recent at A, 1 recent at B, 2 older (outside a 30-day window, inside 90).
    for (let i = 0; i < 3; i++) await prisma.patient.create({ data: { name: `P${i}`, phone: '0700', clinicId: a.clinic.id } });
    await prisma.patient.create({ data: { name: 'PB', phone: '0700', clinicId: b.clinic.id } });
    for (let i = 0; i < 2; i++) await prisma.patient.create({ data: { name: `Old${i}`, phone: '0700', clinicId: a.clinic.id, createdAt: ago(45) } });
    const deleted = await prisma.patient.create({ data: { name: 'Gone', phone: '0700', clinicId: a.clinic.id, deletedAt: new Date() } });
    void deleted;

    // Consultations: 2 recent, 1 in the previous period.
    const patient = await prisma.patient.findFirstOrThrow({ where: { clinicId: a.clinic.id, name: 'P0' } });
    const consult = async (createdAt: Date) => {
      const appt = await prisma.appointment.create({ data: { patientId: patient.id, doctorId: a.nurse.id, clinicId: a.clinic.id, date: createdAt, time: '09:00' } });
      await prisma.consultation.create({ data: { appointmentId: appt.id, patientId: patient.id, diagnosis: 'x', symptoms: 'y', createdAt } });
    };
    await consult(ago(2)); await consult(ago(5)); await consult(ago(40));

    // Revenue: a payment this period, one in the previous period, and a free-trial receipt (not revenue).
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { clinicId: a.clinic.id } });
    await prisma.payment.create({ data: { clinicId: a.clinic.id, subscriptionId: sub.id, amount: 100000, currency: 'UGX', status: 'COMPLETED', updatedAt: ago(3) } });
    await prisma.payment.create({ data: { clinicId: a.clinic.id, subscriptionId: sub.id, amount: 60000, currency: 'UGX', status: 'COMPLETED', updatedAt: ago(40) } });
    await prisma.payment.create({ data: { clinicId: a.clinic.id, subscriptionId: sub.id, amount: 0, currency: 'UGX', status: 'COMPLETED' } });
    // B is on a trial ending in 3 days.
    await prisma.subscription.update({ where: { clinicId: b.clinic.id }, data: { status: 'TRIALING', trialEndsAt: new Date(Date.now() + 3 * DAY) } });

    const res = await get(token, '/super-admin/analytics?days=30');
    expect(res.statusCode).toBe(200);
    const { analytics: r } = res.json();

    expect(r.period.days).toBe(30);
    expect(r.headline.facilities).toMatchObject({ approved: 2, active: 2, pending: 1, suspended: 0 });
    expect(r.headline.staff).toMatchObject({ total: 4, activeAccounts: 4 }); // 2 admins + 2 nurses; no operator
    expect(r.headline.patients).toMatchObject({ total: 6, new: 4 }); // deleted excluded; 2 old ones outside the window
    expect(r.headline.consultations.count).toBe(2);
    expect(r.headline.consultations.change).toBe(1); // 2 now vs 1 before
    expect(r.headline.revenue).toMatchObject({ inPeriod: 100000, payments: 1, monthlyRecurring: 100000, currency: 'UGX' });
    expect(r.headline.revenue.change).toBeCloseTo((100000 - 60000) / 60000);
    expect(r.headline.subscriptions).toMatchObject({ active: 1, trialing: 1, trialsEndingSoon: 1 });

    expect(r.distributions.facilityTypes).toEqual(expect.arrayContaining([{ key: 'HOSPITAL', count: 1 }, { key: 'LABORATORY', count: 1 }]));
    expect(r.distributions.districts.map((d: any) => d.key).sort()).toEqual(['Kampala', 'Mbale']);

    // Day-by-day series cover every day of the period, zero-filled, and add up to the totals.
    for (const key of ['newPatients', 'consultations', 'activeStaff', 'signIns', 'failedSignIns', 'newFacilities', 'appointments']) {
      expect(r.series[key], key).toHaveLength(30);
      expect(r.series[key][29].date).toBe(r.period.to);
      expect(r.series[key][0].date).toBe(r.period.from);
    }
    expect(r.series.newPatients.reduce((s: number, p: any) => s + p.value, 0)).toBe(4);
    expect(r.series.consultations.reduce((s: number, p: any) => s + p.value, 0)).toBe(2);

    // A longer window brings in the older activity.
    const wide = (await get(token, '/super-admin/analytics?days=90')).json().analytics;
    expect(wide.headline.patients.new).toBe(6);
    expect(wide.headline.consultations.count).toBe(3);
    expect(wide.series.newPatients).toHaveLength(90);

    // An unsupported window falls back to 30 days.
    expect((await get(token, '/super-admin/analytics?days=13')).json().analytics.period.days).toBe(30);
  });

  it('rates each facility by how much it is used, with the numbers behind the rating', async () => {
    const { token } = await platform();
    const busy = await facility('Busy Clinic');
    const quiet = await facility('Quiet Clinic');
    const dormant = await facility('Dormant Clinic', { createdAt: ago(200) });
    const never = await facility('Empty Clinic', { createdAt: ago(60) });
    const brandNew = await facility('Fresh Clinic', { createdAt: ago(2) });

    await prisma.user.update({ where: { id: busy.nurse.id }, data: { lastSeenAt: ago(1) } });
    await prisma.user.update({ where: { id: quiet.nurse.id }, data: { lastSeenAt: ago(15) } });
    await prisma.user.update({ where: { id: dormant.nurse.id }, data: { lastSeenAt: ago(90) } });
    await prisma.userActivityDay.create({ data: { userId: busy.nurse.id, clinicId: busy.clinic.id, day: new Date(eastAfricaDay(ago(1)) + 'T00:00:00Z') } });
    await prisma.userActivityDay.create({ data: { userId: busy.admin.id, clinicId: busy.clinic.id, day: new Date(eastAfricaDay(ago(2)) + 'T00:00:00Z') } });
    const p = await prisma.patient.create({ data: { name: 'P', phone: '0700', clinicId: busy.clinic.id } });
    const appt = await prisma.appointment.create({ data: { patientId: p.id, doctorId: busy.nurse.id, clinicId: busy.clinic.id, date: new Date(), time: '09:00' } });
    await prisma.consultation.create({ data: { appointmentId: appt.id, patientId: p.id, diagnosis: 'x', symptoms: 'y' } });

    const { facilities } = (await get(token, '/super-admin/analytics?days=30')).json().analytics;
    const row = (name: string) => facilities.find((f: any) => f.name === name);

    expect(row('Busy Clinic')).toMatchObject({ engagement: 'ACTIVE', staffAccounts: 2, activeStaffInPeriod: 2, patients: 1, newPatientsInPeriod: 1, consultationsInPeriod: 1 });
    expect(row('Quiet Clinic').engagement).toBe('QUIET');
    expect(row('Dormant Clinic').engagement).toBe('DORMANT');
    expect(row('Empty Clinic')).toMatchObject({ engagement: 'NEVER_USED', lastActivityAt: null });
    expect(row('Fresh Clinic').engagement).toBe('NEW');
    expect(facilities.find((f: any) => f.name === 'Bulamu HQ')).toBeUndefined();
    void never; void brandNew;
  });

  it('records who is active each day - once per person per day - and reports daily, weekly and monthly active staff', async () => {
    setUsageTrackingEnabled(true);
    const { token } = await platform();
    const a = await facility('Active Clinic');
    const nurseLogin = await loginAs(app, a.nurse.email, 'TestPassword123!');
    const adminLogin = await loginAs(app, a.admin.email, 'TestPassword123!');

    // Several requests by the same people the same day.
    for (let i = 0; i < 3; i++) await get(nurseLogin.token, '/patients/' + a.clinic.id);
    await get(adminLogin.token, '/patients/' + a.clinic.id);

    await vi.waitFor(async () => expect(await prisma.userActivityDay.count()).toBeGreaterThanOrEqual(2), { timeout: 10_000 });
    const today = eastAfricaDay();
    const nurseDays = await prisma.userActivityDay.findMany({ where: { userId: a.nurse.id } });
    expect(nurseDays).toHaveLength(1);
    expect(nurseDays[0].day.toISOString().slice(0, 10)).toBe(today);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.nurse.id } })).lastSeenAt).not.toBeNull();

    const r = (await get(token, '/super-admin/analytics?days=7')).json().analytics;
    expect(r.headline.staff).toMatchObject({ activeToday: 2, activeThisWeek: 2, activeThisMonth: 2 });
    expect(r.series.activeStaff.at(-1)).toEqual({ date: today, value: 2 });
    expect(r.staffByRole.find((s: any) => s.role === 'NURSE')).toMatchObject({ accounts: 1, activeInPeriod: 1 });
    expect(r.trackingStartedAt).not.toBeNull();
  });

  it('does not count the operator\'s own activity as staff usage', async () => {
    setUsageTrackingEnabled(true);
    const { token, saId } = await platform();
    await facility('Any Clinic');
    await get(token, '/super-admin/system');
    await vi.waitFor(async () => expect(await prisma.userActivityDay.count({ where: { userId: saId } })).toBe(1), { timeout: 10_000 });

    const r = (await get(token, '/super-admin/analytics')).json().analytics;
    expect(r.headline.staff.activeToday).toBe(0);
    expect(r.series.activeStaff.every((p: any) => p.value === 0)).toBe(true);
  });

  it('throttles its own writes: a user seen again within minutes causes no new database work', async () => {
    setUsageTrackingEnabled(true);
    const { clinic, nurse } = await facility('Throttle Clinic');
    trackUserActivity({ id: nurse.id, clinicId: clinic.id }, new Date());
    await vi.waitFor(async () => expect(await prisma.userActivityDay.count()).toBe(1), { timeout: 10_000 });
    const first = (await prisma.user.findUniqueOrThrow({ where: { id: nurse.id } })).lastSeenAt!;

    trackUserActivity({ id: nurse.id, clinicId: clinic.id }, new Date(Date.now() + 60_000)); // a minute later, same day
    await new Promise((r) => setTimeout(r, 400));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: nurse.id } })).lastSeenAt!.getTime()).toBe(first.getTime());

    trackUserActivity({ id: nurse.id, clinicId: clinic.id }, new Date(Date.now() + 11 * 60_000)); // eleven minutes later
    await vi.waitFor(async () => expect((await prisma.user.findUniqueOrThrow({ where: { id: nurse.id } })).lastSeenAt!.getTime()).toBeGreaterThan(first.getTime()), { timeout: 10_000 });
    expect(await prisma.userActivityDay.count()).toBe(1); // still one row for the day
  });

  it('records how staff sign-ins go, by account and never by the typed email', async () => {
    const { token } = await platform();
    setUsageTrackingEnabled(true); // after the operator's own sign-in, which is not what is under test
    const a = await facility('Login Clinic');
    const pendingClinic = await seedClinic({ name: 'Pending', registrationStatus: 'PENDING', isActive: false });
    const blocked = await seedUser({ clinicId: pendingClinic.id, role: 'ADMIN' });

    await loginAs(app, a.nurse.email, 'TestPassword123!');
    await app.inject({ method: 'POST', url: '/auth/login', payload: { email: a.nurse.email, password: 'wrong' } });
    await app.inject({ method: 'POST', url: '/auth/login', payload: { email: blocked.user.email, password: blocked.password } });
    await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'nobody@nowhere.ug', password: 'x' } }); // unknown account: nothing to attribute

    await vi.waitFor(async () => expect(await prisma.loginEvent.count()).toBe(3), { timeout: 10_000 });
    const events = await prisma.loginEvent.findMany({ orderBy: { createdAt: 'asc' } });
    expect(events.map((e) => e.outcome).sort()).toEqual(['BLOCKED', 'SUCCESS', 'WRONG_PASSWORD']);
    expect(JSON.stringify(events)).not.toContain('nowhere.ug');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.nurse.id } })).lastLoginAt).not.toBeNull();

    const r = (await get(token, '/super-admin/analytics')).json().analytics;
    expect(r.security).toMatchObject({ signIns: 1, wrongPassword: 1, blocked: 1, pendingApprovals: 1 });
    expect(r.series.signIns.at(-1).value).toBe(1);
    expect(r.series.failedSignIns.at(-1).value).toBe(2);
  });

  it('reports adoption of the newer features as shares, from counts only', async () => {
    const { token } = await platform();
    const a = await facility('Adoption Clinic');
    const p1 = await prisma.patient.create({ data: { name: 'P1', phone: '0700', clinicId: a.clinic.id, allergyStatus: 'NONE_KNOWN' } });
    await prisma.patient.create({ data: { name: 'P2', phone: '0700', clinicId: a.clinic.id } });
    const appt = await prisma.appointment.create({ data: { patientId: p1.id, doctorId: a.nurse.id, clinicId: a.clinic.id, date: new Date(), time: '09:00' } });
    const c = await prisma.consultation.create({ data: { appointmentId: appt.id, patientId: p1.id, diagnosis: 'SECRET-DIAGNOSIS', symptoms: 'y' } });
    await prisma.diagnosis.create({ data: { consultationId: c.id, description: 'SECRET-DIAGNOSIS', icd10Code: 'B54', type: 'PRIMARY' } });
    await prisma.prescription.create({ data: { consultationId: c.id, medication: 'SECRET-MEDICINE', dosage: '1', frequency: 'OD', duration: '1 day', dispensedAt: new Date(), dispensedByUserId: a.nurse.id } });
    await prisma.prescription.create({ data: { consultationId: c.id, medication: 'Other', dosage: '1', frequency: 'OD', duration: '1 day' } });

    const res = await get(token, '/super-admin/analytics');
    const r = res.json().analytics;
    expect(r.adoption.allergiesRecorded).toMatchObject({ patients: 1, of: 2, share: 0.5 });
    expect(r.adoption.codedDiagnoses).toMatchObject({ consultations: 1, of: 1, share: 1 });
    expect(r.adoption.prescriptions).toMatchObject({ written: 2, dispensed: 1, dispensedShare: 0.5 });
    expect(r.adoption.facilitiesRecording).toEqual({ count: 1, of: 1 });

    // The operator's view is about volume - never the clinical content or who the patients are.
    expect(res.body).not.toContain('SECRET-DIAGNOSIS');
    expect(res.body).not.toContain('SECRET-MEDICINE');
    expect(res.body).not.toContain('"P1"');
  });

  describe('staff directory', () => {
    it('lists staff with their usage, filters and pages, and never includes platform operators', async () => {
      const { token } = await platform();
      const a = await facility('Directory Clinic');
      const b = await facility('Second Clinic');
      await prisma.user.update({ where: { id: a.nurse.id }, data: { lastSeenAt: ago(1), lastLoginAt: ago(1) } });
      await prisma.userActivityDay.create({ data: { userId: a.nurse.id, clinicId: a.clinic.id, day: new Date(eastAfricaDay(ago(1)) + 'T00:00:00Z') } });
      await prisma.userActivityDay.create({ data: { userId: a.nurse.id, clinicId: a.clinic.id, day: new Date(eastAfricaDay(ago(3)) + 'T00:00:00Z') } });
      await prisma.userActivityDay.create({ data: { userId: a.nurse.id, clinicId: a.clinic.id, day: new Date(eastAfricaDay(ago(60)) + 'T00:00:00Z') } }); // outside the 30 days
      await prisma.user.update({ where: { id: b.admin.id }, data: { isActive: false } });

      const all = (await get(token, '/super-admin/users')).json();
      expect(all.total).toBe(4);
      expect(all.users.map((u: any) => u.role)).not.toContain('SUPER_ADMIN');
      expect(all.users[0]).toMatchObject({ name: 'Directory Clinic Nurse', activeDaysLast30: 2, clinic: { name: 'Directory Clinic' } }); // most recently seen first
      expect(all.users[0].password).toBeUndefined();

      expect((await get(token, '/super-admin/users?search=second')).json().total).toBe(2);
      await prisma.user.update({ where: { id: b.nurse.id }, data: { name: 'Zed Person' } });
      expect((await get(token, '/super-admin/users?search=second clinic')).json().users.map((u: any) => u.name).sort()).toEqual(['Second Clinic Admin', 'Zed Person']); // matches the facility's name too
      expect((await get(token, '/super-admin/users?role=NURSE')).json().total).toBe(2);
      expect((await get(token, '/super-admin/users?role=SUPER_ADMIN')).json().users.every((u: any) => u.role !== 'SUPER_ADMIN')).toBe(true);
      expect((await get(token, `/super-admin/users?clinicId=${b.clinic.id}&status=inactive`)).json().users.map((u: any) => u.name)).toEqual(['Second Clinic Admin']);
      const page2 = (await get(token, '/super-admin/users?pageSize=3&page=2')).json();
      expect(page2.users).toHaveLength(1);
      expect(page2.total).toBe(4);
    });
  });

  describe('exports', () => {
    it('downloads the facilities table, the day-by-day series and the staff directory as CSV', async () => {
      const { token } = await platform();
      const a = await facility('Export Clinic', { district: 'Kampala' });
      await prisma.user.update({ where: { id: a.nurse.id }, data: { lastSeenAt: ago(1) } });

      const facilities = await get(token, '/super-admin/analytics/export?dataset=facilities&days=30');
      expect(facilities.statusCode).toBe(200);
      expect(facilities.headers['content-type']).toContain('text/csv');
      expect(facilities.headers['content-disposition']).toContain('bulamu-facility-usage-30d-');
      expect(facilities.body.split('\r\n')[0]).toContain('Facility ID,Name,Type,District,Engagement');
      expect(facilities.body).toContain('Export Clinic');

      const daily = await get(token, '/super-admin/analytics/export?dataset=daily&days=7');
      const lines = daily.body.trim().split('\r\n');
      expect(lines[0]).toContain('Date (EAT),Active staff,New patients,Consultations');
      expect(lines).toHaveLength(8); // header + 7 days
      expect(daily.headers['content-disposition']).toContain('bulamu-daily-activity-7d-');

      const users = await get(token, '/super-admin/analytics/export?dataset=users');
      expect(users.body).toContain('Export Clinic Nurse');
      expect(users.body.split('\r\n')[0]).toContain('Last seen');
      expect(users.body).not.toMatch(/\$2[aby]\$/); // no password hashes
    });
  });

  describe('system report', () => {
    it('reports the database, storage, integrations and the API\'s own response times', async () => {
      const { token } = await platform();
      await facility('System Clinic');
      await get(token, '/super-admin/users');
      await get(token, '/super-admin/analytics');

      const res = await get(token, '/super-admin/system');
      expect(res.statusCode).toBe(200);
      const s = res.json().system;

      expect(s.server.nodeVersion).toMatch(/^v\d+/);
      expect(s.database.pingMs).toBeGreaterThan(0);
      expect(s.database.sizeBytes).toBeGreaterThan(0);
      expect(s.database.migrationsApplied).toBeGreaterThan(20);
      expect(s.database.latestMigration).toMatch(/usage_analytics/);
      expect(s.database.largestTables.length).toBeGreaterThan(0);
      expect(s.database.totals.facilities).toBe(2);
      expect(s.storage).toMatchObject({ documents: 0, documentBytes: 0 });
      expect(s.configuration.map((c: any) => c.key)).toEqual(['email', 'payments', 'paymentNotices', 'documents', 'frontend']);
      expect(s.configuration.every((c: any) => typeof c.ok === 'boolean' && c.hint)).toBe(true);

      // The requests just made are in the API's own numbers, labelled by route pattern.
      expect(s.runtime.sinceStart.requests).toBeGreaterThanOrEqual(2);
      expect(s.runtime.busiestRoutes.map((r: any) => r.route)).toEqual(expect.arrayContaining(['GET /super-admin/users', 'GET /super-admin/analytics']));
      expect(s.runtime.uptimeSeconds).toBeGreaterThanOrEqual(0);

      // Configuration is reported as yes/no - never the secret values.
      const body = res.body;
      expect(body).not.toContain(process.env.JWT_SECRET as string);
      expect(body).not.toMatch(/DATABASE_URL|postgresql:\/\//);
    });
  });

  it('forgets usage records older than 13 months whenever the analytics are opened', async () => {
    const { token } = await platform();
    const a = await facility('Old Records Clinic');
    await prisma.userActivityDay.create({ data: { userId: a.nurse.id, clinicId: a.clinic.id, day: new Date(eastAfricaDay(ago(500)) + 'T00:00:00Z') } });
    await prisma.userActivityDay.create({ data: { userId: a.nurse.id, clinicId: a.clinic.id, day: new Date(eastAfricaDay(ago(10)) + 'T00:00:00Z') } });
    await prisma.loginEvent.create({ data: { userId: a.nurse.id, clinicId: a.clinic.id, outcome: 'SUCCESS', createdAt: ago(500) } });
    await prisma.loginEvent.create({ data: { userId: a.nurse.id, clinicId: a.clinic.id, outcome: 'SUCCESS', createdAt: ago(10) } });

    await get(token, '/super-admin/analytics');
    expect(await prisma.userActivityDay.count()).toBe(1);
    expect(await prisma.loginEvent.count()).toBe(1);
  });
});
