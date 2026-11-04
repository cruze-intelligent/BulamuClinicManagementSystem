import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';
import { ADMIN_NOTIFY_EMAIL } from '../src/lib/mailer';
import { pdfText } from './pdf-text';

const sendMailMock = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/mailer')>();
  return { ...actual, sendMail: sendMailMock };
});

vi.setConfig({ testTimeout: 60_000 });

const DAY = 24 * 60 * 60 * 1000;
let app: FastifyInstance;

beforeEach(async () => {
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue({ sent: true, via: 'relay' });
  await resetDb();
  app = await buildTestApp();
});

afterAll(async () => {
  await app?.close();
});

type Role = 'ADMIN' | 'DOCTOR' | 'NURSE' | 'PHARMACIST' | 'STAFF' | 'LAB_TECH';

async function facility(name = 'Mbarara Family Clinic', phone = '0772 111 222') {
  const clinic = await seedClinic({ name, phone, address: 'Plot 4, High Street' });
  const users = {} as Record<Role, { id: string; email: string; token: string }>;
  for (const role of ['ADMIN', 'DOCTOR', 'NURSE', 'PHARMACIST', 'STAFF', 'LAB_TECH'] as Role[]) {
    const { user, password } = await seedUser({ clinicId: clinic.id, role, name: role === 'ADMIN' ? 'Grace Nankya' : `${role} Person` });
    users[role] = { id: user.id, email: user.email, token: (await loginAs(app, user.email, password)).token };
  }
  return { clinic, users };
}
type Facility = Awaited<ReturnType<typeof facility>>;

async function bulamuAdmin() {
  const hq = await seedClinic({ name: 'Bulamu HQ', phone: '0700 999 999' });
  const { user, password } = await seedUser({ clinicId: hq.id, role: 'SUPER_ADMIN', name: 'Bulamu Operator' });
  return { id: user.id, token: (await loginAs(app, user.email, password)).token };
}

const call = (token: string, method: 'GET' | 'PATCH' | 'POST' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, headers: authHeader(token), ...(payload ? { payload } : {}) });

const edit = (f: Facility, payload: object) => call(f.users.ADMIN.token, 'PATCH', `/clinics/${f.clinic.id}/details`, payload);
const details = async (f: Facility, role: Role = 'ADMIN') => (await call(f.users[role].token, 'GET', `/clinics/${f.clinic.id}/details`)).json();
const stored = (f: Facility) => prisma.clinic.findUniqueOrThrow({ where: { id: f.clinic.id } });

/** Uses up the facility's three direct changes. */
async function useAllowance(f: Facility) {
  for (const address of ['Plot 5, High Street', 'Plot 6, High Street', 'Plot 7, High Street']) {
    expect((await edit(f, { address })).statusCode).toBe(200);
  }
}

describe('a facility administrator edits the facility details', () => {
  it('makes the first three changes straight away, counting down what is left', async () => {
    const f = await facility();
    const before = await details(f);
    expect(before.facility).toMatchObject({ name: 'Mbarara Family Clinic', phone: '0772 111 222', address: 'Plot 4, High Street' });
    expect(before.allowance).toMatchObject({ limit: 3, used: 0, remaining: 3, windowDays: 365, nextFreeAt: null });
    expect(before.pending).toBeNull();

    const first = await edit(f, { name: '  Mbarara  Family Clinic & Maternity ', phone: '+256 772 333 444' });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ outcome: 'APPLIED', allowance: { used: 1, remaining: 2 } });
    expect(first.json().change.changes).toEqual({
      name: { from: 'Mbarara Family Clinic', to: 'Mbarara Family Clinic & Maternity' },
      phone: { from: '0772 111 222', to: '+256 772 333 444' },
    });
    const clinic = await stored(f);
    expect(clinic).toMatchObject({ name: 'Mbarara Family Clinic & Maternity', phone: '+256 772 333 444', phoneKey: '772333444' });

    expect((await edit(f, { district: 'Mbarara', subCounty: 'Kakoba', parish: 'Ruharo' })).json().allowance.remaining).toBe(1);
    expect((await edit(f, { facilityType: 'HEALTH_CENTRE_III', parish: '' })).json().allowance.remaining).toBe(0);
    expect(await stored(f)).toMatchObject({ facilityType: 'HEALTH_CENTRE_III', district: 'Mbarara', subCounty: 'Kakoba', parish: null });

    const after = await details(f);
    expect(after.allowance).toMatchObject({ used: 3, remaining: 0 });
    expect(new Date(after.allowance.nextFreeAt).getTime()).toBeGreaterThan(Date.now() + 364 * DAY);
    expect(after.history.map((row: any) => row.status)).toEqual(['APPLIED', 'APPLIED', 'APPLIED']);
    expect(after.history[0].requestedByUser.name).toBe('Grace Nankya');

    // Each change is in the audit trail; none of them sends an email.
    expect(await prisma.auditLog.count({ where: { entity: 'FacilityDetails', clinicId: f.clinic.id } })).toBe(3);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('prints the new details on the facility documents', async () => {
    const f = await facility();
    await edit(f, { name: 'Ruharo Community Hospital', phone: '0772 555 666' });
    const yesterday = new Date(Date.now() - DAY).toISOString().slice(0, 10);
    const pdf = await call(f.users.ADMIN.token, 'GET', `/finances/${f.clinic.id}/report?from=${yesterday}&to=${yesterday}&format=pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdfText(pdf.rawPayload)).toContain('Ruharo Community Hospital');
  });

  it('checks what is typed, and a refused change uses up nothing', async () => {
    const f = await facility();
    await seedClinic({ name: 'Kabale Clinic', phone: '0752 000 111' });
    const refused: Array<[object, number, RegExp]> = [
      [{ name: '   ' }, 400, /Name can not be left empty/],
      [{ name: 'AB' }, 400, /at least 3 characters/],
      [{ name: 'x'.repeat(121) }, 400, /at most 120/],
      [{ address: '' }, 400, /Address can not be left empty/],
      [{ facilityType: 'SPA' }, 400, /facility type from the list/],
      [{ phone: 'call me' }, 400, /phone number of 9 to 15 digits/],
      [{ phone: '0772' }, 400, /phone number of 9 to 15 digits/],
      [{ name: 42 }, 400, /Name must be text/],
      [{ name: 'Mbarara Family Clinic', address: ' Plot 4,  High Street ' }, 400, /Nothing has changed/],
      [{ somethingElse: 'x' }, 400, /Nothing has changed/],
      [{ phone: '+256 752 000 111' }, 409, /Another facility on Bulamu already uses this phone number/],
    ];
    for (const [payload, status, message] of refused) {
      const res = await edit(f, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(status);
      expect(res.json().error).toMatch(message);
    }
    expect(await stored(f)).toMatchObject({ name: 'Mbarara Family Clinic', phone: '0772 111 222', address: 'Plot 4, High Street' });
    expect((await details(f)).allowance.remaining).toBe(3);
    expect(await prisma.facilityDetailChange.count()).toBe(0);
  });

  it('lets only the facility administrator change the details, and only of their own facility', async () => {
    const f = await facility();
    const other = await facility('Kabale Clinic', '0752 000 111');
    const bulamu = await bulamuAdmin();

    for (const role of ['DOCTOR', 'NURSE', 'PHARMACIST', 'STAFF', 'LAB_TECH'] as Role[]) {
      // Everyone at the facility sees the details, but not the change records.
      const seen = await details(f, role);
      expect(seen.facility.name, role).toBe('Mbarara Family Clinic');
      expect(seen.allowance, role).toBeUndefined();
      expect(seen.history, role).toBeUndefined();
      expect((await call(f.users[role].token, 'PATCH', `/clinics/${f.clinic.id}/details`, { name: 'Taken Over' })).statusCode, role).toBe(403);
      expect((await call(f.users[role].token, 'DELETE', `/clinics/${f.clinic.id}/details/pending`)).statusCode, role).toBe(403);
    }
    expect((await call(other.users.ADMIN.token, 'PATCH', `/clinics/${f.clinic.id}/details`, { name: 'Taken Over' })).statusCode).toBe(403);
    expect((await call(other.users.ADMIN.token, 'GET', `/clinics/${f.clinic.id}/details`)).statusCode).toBe(403);
    // Bulamu reviews changes; it does not make them on a facility's behalf here.
    expect((await call(bulamu.token, 'PATCH', `/clinics/${f.clinic.id}/details`, { name: 'Taken Over' })).statusCode).toBe(403);
    expect((await stored(f)).name).toBe('Mbarara Family Clinic');
    expect((await call(f.users.ADMIN.token, 'GET', '/super-admin/facility-changes')).statusCode).toBe(403);
  });
});

describe('past three changes in twelve months, Bulamu reviews each one', () => {
  it('holds the fourth change for review, with a reason, and tells the Bulamu team once', async () => {
    const f = await facility();
    await useAllowance(f);
    sendMailMock.mockClear();

    const noReason = await edit(f, { name: 'Mbarara Hospital' });
    expect(noReason.statusCode).toBe(400);
    expect(noReason.json().error).toMatch(/already changed its details 3 times in the last 12 months.*Say briefly why/);

    const held = await edit(f, { name: 'Mbarara Hospital', phone: '0772 999 000', note: 'We were upgraded to a hospital by the ministry' });
    expect(held.statusCode).toBe(202);
    expect(held.json()).toMatchObject({ outcome: 'PENDING', facility: { name: 'Mbarara Family Clinic' } });
    expect(held.json().message).toMatch(/Sent to Bulamu for review/);
    expect(await stored(f)).toMatchObject({ name: 'Mbarara Family Clinic', phone: '0772 111 222' });

    await vi.waitFor(() => expect(sendMailMock).toHaveBeenCalledTimes(1));
    const alert = sendMailMock.mock.calls[0][0];
    expect(alert.to).toBe(ADMIN_NOTIFY_EMAIL);
    expect(alert.subject).toBe('[Bulamu] Facility details to review - Mbarara Family Clinic');
    expect(alert.html).toContain('Mbarara Family Clinic -&gt; Mbarara Hospital');
    expect(alert.html).toContain('We were upgraded to a hospital by the ministry');

    const seen = await details(f);
    expect(seen.pending).toMatchObject({ status: 'PENDING', note: 'We were upgraded to a hospital by the ministry' });
    expect(seen.allowance.remaining).toBe(0);

    // One change waits at a time.
    const second = await edit(f, { address: 'Plot 9', note: 'Moved' });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toMatch(/already waiting for Bulamu/);
  });

  it('makes the change when a Bulamu administrator approves it, and tells the facility', async () => {
    const f = await facility();
    const bulamu = await bulamuAdmin();
    await useAllowance(f);
    await edit(f, { name: 'Mbarara Hospital', facilityType: 'HOSPITAL', note: 'Upgraded by the ministry' });

    const queue = await call(bulamu.token, 'GET', '/super-admin/facility-changes');
    expect(queue.statusCode).toBe(200);
    const [waiting] = queue.json().changes;
    expect(queue.json().changes).toHaveLength(1);
    expect(waiting).toMatchObject({
      clinic: { name: 'Mbarara Family Clinic', facilityCode: f.clinic.facilityCode }, note: 'Upgraded by the ministry', changesThisYear: 3,
      requestedByUser: { name: 'Grace Nankya', email: f.users.ADMIN.email },
      rows: [['Name', 'Mbarara Family Clinic', 'Mbarara Hospital'], ['Type', 'Clinic', 'Hospital']],
    });

    sendMailMock.mockClear();
    const approved = await call(bulamu.token, 'POST', `/super-admin/facility-changes/${waiting.id}/approve`, {});
    expect(approved.statusCode).toBe(200);
    expect(approved.json().change).toMatchObject({ status: 'APPROVED', reviewedBy: bulamu.id });
    expect(await stored(f)).toMatchObject({ name: 'Mbarara Hospital', facilityType: 'HOSPITAL' });

    await vi.waitFor(() => expect(sendMailMock).toHaveBeenCalledTimes(1));
    const letter = sendMailMock.mock.calls[0][0];
    expect(letter.to).toBe(f.users.ADMIN.email);
    expect(letter.subject).toBe('Facility details updated - Mbarara Hospital - Bulamu');
    expect(letter.html).toContain('Your facility details are updated');
    expect(letter.html).toContain('<strong>Mbarara Hospital</strong>');

    // Dealt with once only; an approved change is not one of the facility's own three.
    expect((await call(bulamu.token, 'POST', `/super-admin/facility-changes/${waiting.id}/approve`, {})).statusCode).toBe(409);
    expect((await call(bulamu.token, 'GET', '/super-admin/facility-changes')).json().changes).toHaveLength(0);
    const seen = await details(f);
    expect(seen.pending).toBeNull();
    expect(seen.allowance).toMatchObject({ used: 3, remaining: 0 });
    expect(seen.history[0]).toMatchObject({ status: 'APPROVED', reviewedByUser: { name: 'Bulamu Operator' } });
    expect((await edit(f, { address: 'Plot 10' })).statusCode).toBe(400); // still needs a reason - and so a review
  });

  it('leaves the details as they were when the change is turned down, with the reason sent to the facility', async () => {
    const f = await facility();
    const bulamu = await bulamuAdmin();
    await useAllowance(f);
    const held = (await edit(f, { name: 'Mbarara Teaching Hospital', note: 'New name' })).json().change;

    const noReason = await call(bulamu.token, 'POST', `/super-admin/facility-changes/${held.id}/reject`, {});
    expect(noReason.statusCode).toBe(400);
    expect(noReason.json().error).toMatch(/Say why/);

    sendMailMock.mockClear();
    const rejected = await call(bulamu.token, 'POST', `/super-admin/facility-changes/${held.id}/reject`, { note: 'Send the ministry letter confirming the new name' });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().change).toMatchObject({ status: 'REJECTED', reviewNote: 'Send the ministry letter confirming the new name' });
    expect((await stored(f)).name).toBe('Mbarara Family Clinic');

    await vi.waitFor(() => expect(sendMailMock).toHaveBeenCalledTimes(1));
    const letter = sendMailMock.mock.calls[0][0];
    expect(letter.to).toBe(f.users.ADMIN.email);
    expect(letter.subject).toBe('Facility details not changed - Mbarara Family Clinic - Bulamu');
    expect(letter.html).toContain('Send the ministry letter confirming the new name');

    // The facility may send a corrected change.
    expect((await edit(f, { name: 'Mbarara Teaching Hospital', note: 'Ministry letter attached by email' })).statusCode).toBe(202);
  });

  it('lets the facility withdraw a change before it is reviewed', async () => {
    const f = await facility();
    const bulamu = await bulamuAdmin();
    await useAllowance(f);
    const held = (await edit(f, { address: 'Plot 20', note: 'Moved' })).json().change;

    expect((await call(f.users.ADMIN.token, 'DELETE', `/clinics/${f.clinic.id}/details/pending`)).statusCode).toBe(200);
    expect((await prisma.facilityDetailChange.findUniqueOrThrow({ where: { id: held.id } })).status).toBe('WITHDRAWN');
    expect((await call(f.users.ADMIN.token, 'DELETE', `/clinics/${f.clinic.id}/details/pending`)).statusCode).toBe(404);
    expect((await call(bulamu.token, 'POST', `/super-admin/facility-changes/${held.id}/approve`, {})).statusCode).toBe(409);
    expect((await stored(f)).address).toBe('Plot 7, High Street');
    expect((await edit(f, { address: 'Plot 21', note: 'Moved again' })).statusCode).toBe(202);
  });

  it('checks the phone number again when the change is approved', async () => {
    const f = await facility();
    const bulamu = await bulamuAdmin();
    await useAllowance(f);
    const held = (await edit(f, { phone: '0752 000 111', note: 'New line' })).json().change;
    // Meanwhile another facility registers with that number.
    await seedClinic({ name: 'Kabale Clinic', phone: '0752 000 111' });
    const approved = await call(bulamu.token, 'POST', `/super-admin/facility-changes/${held.id}/approve`, {});
    expect(approved.statusCode).toBe(409);
    expect((await prisma.facilityDetailChange.findUniqueOrThrow({ where: { id: held.id } })).status).toBe('PENDING');
    expect((await stored(f)).phone).toBe('0772 111 222');
  });

  it('counts only the last twelve months: older changes free up the allowance again', async () => {
    const f = await facility();
    await useAllowance(f);
    const changes = await prisma.facilityDetailChange.findMany({ orderBy: { createdAt: 'asc' } });
    await prisma.facilityDetailChange.update({ where: { id: changes[0].id }, data: { createdAt: new Date(Date.now() - 366 * DAY) } });
    await prisma.facilityDetailChange.update({ where: { id: changes[1].id }, data: { createdAt: new Date(Date.now() - 200 * DAY) } });

    expect((await details(f)).allowance).toMatchObject({ used: 2, remaining: 1 });
    expect((await edit(f, { address: 'Plot 30' })).statusCode).toBe(200);
    const full = (await details(f)).allowance;
    expect(full.remaining).toBe(0);
    // The next direct change frees up when the one made 200 days ago turns a year old.
    expect(Math.round((new Date(full.nextFreeAt).getTime() - Date.now()) / DAY)).toBe(165);
  });

  it('never lets changes sent at the same moment slip past the allowance', async () => {
    const f = await facility();
    const results = await Promise.all(
      ['Plot 41', 'Plot 42', 'Plot 43', 'Plot 44', 'Plot 45'].map((address) => edit(f, { address, note: 'Same moment' })),
    );
    const codes = results.map((res) => res.statusCode).sort();
    // Three made at once, one held for review, and the last refused while that one waits.
    expect(codes).toEqual([200, 200, 200, 202, 409]);
    expect(await prisma.facilityDetailChange.count({ where: { status: 'APPLIED' } })).toBe(3);
    expect(await prisma.facilityDetailChange.count({ where: { status: 'PENDING' } })).toBe(1);
  });

  it('keeps demonstration facilities to their three changes, without sending them for review', async () => {
    const f = await facility();
    await prisma.clinic.update({ where: { id: f.clinic.id }, data: { isDemo: true } });
    await useAllowance(f);
    const res = await edit(f, { address: 'Plot 50', note: 'Trying it out' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/demonstration facility/);
    expect(await prisma.facilityDetailChange.count({ where: { status: 'PENDING' } })).toBe(0);
  });
});
