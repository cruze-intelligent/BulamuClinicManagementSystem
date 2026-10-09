import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import { prisma } from '../src/lib/prisma';

const sendMailMock = vi.hoisted(() => vi.fn());
const sheetsAppendMock = vi.hoisted(() => vi.fn());

vi.mock('../src/lib/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/mailer')>();
  return { ...actual, sendMail: sendMailMock };
});
vi.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: class {} },
    sheets: () => ({ spreadsheets: { values: { append: sheetsAppendMock } } }),
  },
}));

const OPERATOR = 'starplay.stargames@gmail.com';

describe('operator alerts and facility emails', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue({ sent: true, via: 'relay' });
    sheetsAppendMock.mockReset();
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  const mails = () => sendMailMock.mock.calls.map(([mail]) => mail as { to: string; subject: string; html: string; attachments?: any[] });
  const mailTo = (address: string) => mails().filter((m) => m.to.split(',').map((a) => a.trim()).includes(address));
  const waitForMail = (address: string, count = 1) =>
    vi.waitFor(() => expect(mailTo(address).length).toBeGreaterThanOrEqual(count), { timeout: 10_000 });

  async function operator() {
    const hq = await seedClinic({ name: 'Bulamu HQ' });
    const { user, password } = await seedUser({ clinicId: hq.id, role: 'SUPER_ADMIN', name: 'Sam Operator' });
    return (await loginAs(app, user.email, password)).token;
  }

  async function pendingFacility(name = 'Mbale Family Clinic') {
    const clinic = await seedClinic({ name, registrationStatus: 'PENDING', isActive: false, phone: '0772123456' });
    const { user } = await seedUser({ clinicId: clinic.id, role: 'ADMIN', email: 'owner@mbaleclinic.ug', name: 'Grace Owner' });
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    return clinic;
  }

  it('tells the operator about every new registration, with the details needed to review it', async () => {
    const response = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: {
        facilityName: 'Kasese <b>Health</b> Centre', facilityType: 'HEALTH_CENTRE_III', phone: '0700111999', address: 'Plot 3, Kasese',
        district: 'Kasese', subCounty: 'Bwera', parish: 'Mpondwe',
        adminName: 'Joy Admin', adminEmail: 'joy@kasese.ug', adminPassword: 'SuperSecret123!',
      },
    });
    expect(response.statusCode).toBe(200);
    await waitForMail(OPERATOR);

    const alert = mailTo(OPERATOR)[0];
    expect(alert.subject).toBe('[Bulamu] New facility awaiting approval - Kasese <b>Health</b> Centre');
    expect(alert.html).toContain(response.json().facilityCode);
    expect(alert.html).toContain('Health centre III');
    expect(alert.html).toContain('Mpondwe, Bwera, Kasese');
    expect(alert.html).toContain('joy@kasese.ug');
    expect(alert.html).toContain('Kasese &lt;b&gt;Health&lt;/b&gt; Centre'); // escaped, not rendered
    expect(alert.html).toContain('http://localhost:3000/super-admin');
    expect(mailTo('joy@kasese.ug')).toHaveLength(1); // and the registrant's own confirmation
  });

  it('emails an approved facility its approval with the trial receipt, then tells the operator it was delivered', async () => {
    const token = await operator();
    const clinic = await pendingFacility();

    const res = await app.inject({ method: 'PATCH', url: `/clinics/${clinic.id}/approve`, headers: authHeader(token) });
    expect(res.statusCode).toBe(200);
    await waitForMail(OPERATOR);

    const approval = mailTo('owner@mbaleclinic.ug')[0];
    expect(approval.subject).toBe('Mbale Family Clinic is approved on Bulamu');
    expect(approval.html).toContain(clinic.facilityCode);
    expect(approval.html).toContain('owner@mbaleclinic.ug');
    expect(approval.html).toContain('http://localhost:3000/auth/login');
    expect(approval.attachments?.[0]).toMatchObject({ contentType: 'application/pdf' });
    expect(approval.attachments?.[0].content.subarray(0, 4).toString()).toBe('%PDF');

    const alert = mailTo(OPERATOR)[0];
    expect(alert.subject).toBe('[Bulamu] Facility approved - Mbale Family Clinic');
    expect(alert.html).toContain('Sam Operator');
    expect(alert.html).toContain('Delivered to the mail server');
  });

  it('warns the operator when the approval email could not be delivered', async () => {
    const token = await operator();
    const clinic = await pendingFacility();
    sendMailMock.mockImplementation(async (mail: { to: string }) =>
      mail.to === 'owner@mbaleclinic.ug' ? { sent: false, reason: 'Mail bridge unreachable: timeout' } : { sent: true });

    await app.inject({ method: 'PATCH', url: `/clinics/${clinic.id}/approve`, headers: authHeader(token) });
    await waitForMail(OPERATOR);
    expect(mailTo(OPERATOR)[0].html).toContain('NOT delivered - Mail bridge unreachable: timeout');
  });

  it('tells the facility and the operator about a rejection, with the reason', async () => {
    const token = await operator();
    const clinic = await pendingFacility();
    await app.inject({ method: 'PATCH', url: `/clinics/${clinic.id}/reject`, headers: authHeader(token), payload: { reason: 'Licence number could not be verified' } });
    await waitForMail(OPERATOR);
    expect(mailTo('owner@mbaleclinic.ug')[0].html).toContain('Licence number could not be verified');
    expect(mailTo(OPERATOR)[0].subject).toBe('[Bulamu] Facility rejected - Mbale Family Clinic');
    expect(mailTo(OPERATOR)[0].html).toContain('Licence number could not be verified');
  });

  it('welcomes the administrator of a facility the operator adds directly, and never returns password hashes', async () => {
    const token = await operator();
    const res = await app.inject({
      method: 'POST', url: '/clinics/register', headers: authHeader(token),
      payload: { name: 'Gulu Pharmacy', facilityType: 'PHARMACY', phone: '0788000111', address: 'Gulu', adminEmail: 'boss@gulupharmacy.ug', adminPassword: 'SuperSecret123!', adminName: 'Okello Boss' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).not.toMatch(/\$2[aby]\$/);
    await waitForMail(OPERATOR);

    const welcome = mailTo('boss@gulupharmacy.ug')[0];
    expect(welcome.subject).toBe('Gulu Pharmacy is approved on Bulamu');
    expect(welcome.html).not.toContain('SuperSecret123!');
    expect(welcome.html).not.toContain('receipt for your free trial is attached');
    expect(mailTo(OPERATOR)[0].subject).toBe('[Bulamu] Facility added - Gulu Pharmacy');
  });

  it('tells the facility and the operator when a facility is suspended or reactivated - once per change', async () => {
    const token = await operator();
    const clinic = await seedClinic({ name: 'Lira Clinic' });
    await seedUser({ clinicId: clinic.id, role: 'ADMIN', email: 'admin@liraclinic.ug' });

    const suspend = () => app.inject({ method: 'PATCH', url: `/clinics/${clinic.id}/status`, headers: authHeader(token), payload: { isActive: false } });
    expect((await suspend()).statusCode).toBe(200);
    await waitForMail(OPERATOR);
    expect(mailTo('admin@liraclinic.ug')[0].subject).toBe('Lira Clinic has been suspended on Bulamu');
    expect(mailTo(OPERATOR)[0].subject).toBe('[Bulamu] Facility suspended - Lira Clinic');

    await suspend(); // already suspended: nothing new to say
    await new Promise((r) => setTimeout(r, 300));
    expect(mailTo(OPERATOR)).toHaveLength(1);

    await app.inject({ method: 'PATCH', url: `/clinics/${clinic.id}/status`, headers: authHeader(token), payload: { isActive: true } });
    await waitForMail(OPERATOR, 2);
    expect(mailTo('admin@liraclinic.ug')[1].subject).toBe('Lira Clinic has been reactivated on Bulamu');

    const audit = await prisma.auditLog.findMany({ where: { recordId: clinic.id } });
    expect(audit).toHaveLength(2);

    const missing = await app.inject({ method: 'PATCH', url: '/clinics/00000000-0000-0000-0000-000000000000/status', headers: authHeader(token), payload: { isActive: false } });
    expect(missing.statusCode).toBe(404);
  });

  it('tells the operator when a facility is deleted', async () => {
    const token = await operator();
    const clinic = await seedClinic({ name: 'Old Clinic' });
    const res = await app.inject({ method: 'DELETE', url: `/clinics/${clinic.id}`, headers: authHeader(token), payload: { confirmName: 'Old Clinic' } });
    expect(res.statusCode).toBe(200);
    await waitForMail(OPERATOR);
    expect(mailTo(OPERATOR)[0].subject).toBe('[Bulamu] Facility deleted - Old Clinic');
  });

  it('sends feedback to the feedback inbox and the operator in one email, without making the user wait', async () => {
    const clinic = await seedClinic({ name: 'Feedback Clinic' });
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'NURSE', name: 'Nora Nurse' });
    const { token } = await loginAs(app, user.email, password);
    sendMailMock.mockImplementation(() => new Promise(() => {})); // a mail server that never answers

    const res = await app.inject({ method: 'POST', url: '/comments', headers: authHeader(token), payload: { entityType: 'FEEDBACK', body: 'The <i>new</i> forms are great' } });
    expect(res.statusCode).toBe(200);

    const mail = mails()[0];
    expect(mail.to).toBe(`admin@bulamu.site, ${OPERATOR}`);
    expect(mail.html).toContain('The &lt;i&gt;new&lt;/i&gt; forms are great');
  });

  it('still tells the operator about an access request when the Google Sheet is unavailable', async () => {
    sheetsAppendMock.mockRejectedValue(new Error('Sheets credentials missing'));
    const payload = { facilityName: 'Hoima Clinic', contactPerson: 'Amos', phone: '0700', email: 'amos@hoima.ug', preferredPlan: 'STANDARD' };

    const res = await app.inject({ method: 'POST', url: '/leads', payload });
    expect(res.statusCode).toBe(200);
    expect(mailTo(OPERATOR)[0].subject).toBe('[Bulamu] New access request - Hoima Clinic');

    // Lost only when neither the sheet nor the email worked.
    sendMailMock.mockResolvedValue({ sent: false, reason: 'down' });
    expect((await app.inject({ method: 'POST', url: '/leads', payload })).statusCode).toBe(500);
  });

  describe('test email from the System page', () => {
    it('goes only to the operator inbox and reports what happened', async () => {
      const token = await operator();
      const res = await app.inject({ method: 'POST', url: '/super-admin/system/test-email', headers: authHeader(token), payload: { to: 'someone-else@example.com' } });
      expect(res.statusCode).toBe(200);
      expect(res.json().result).toEqual({ sent: true, via: 'relay' });
      expect(res.json().mail).toMatchObject({ operatorInbox: OPERATOR });
      expect(mails()).toHaveLength(1);
      expect(mails()[0].to).toBe(OPERATOR);
      expect(mails()[0].subject).toBe('[Bulamu] Test email');
    });

    it('is for the platform operator only', async () => {
      const clinic = await seedClinic();
      const { user, password } = await seedUser({ clinicId: clinic.id, role: 'ADMIN' });
      const { token } = await loginAs(app, user.email, password);
      expect((await app.inject({ method: 'POST', url: '/super-admin/system/test-email', headers: authHeader(token) })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: '/super-admin/system/test-email' })).statusCode).toBe(401);
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it('shows email status on the System page', async () => {
      const token = await operator();
      const system = (await app.inject({ method: 'GET', url: '/super-admin/system', headers: authHeader(token) })).json().system;
      expect(system.mail).toMatchObject({ configured: false, operatorInbox: OPERATOR });
      expect(JSON.stringify(system.mail)).not.toMatch(/pass/i);
    });
  });
});
