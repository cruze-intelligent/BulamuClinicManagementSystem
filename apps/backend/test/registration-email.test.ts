import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers';
import { resetDb } from './db';

const sendMailMock = vi.hoisted(() => vi.fn());

vi.mock('../src/lib/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/mailer')>();
  return { ...actual, sendMail: sendMailMock };
});

const registration = {
  facilityName: 'Email Test Clinic',
  phone: '0700333444',
  address: 'Kampala',
  adminName: 'Grace Nakato',
  adminEmail: 'grace@emailtest.ug',
  adminPassword: 'SuperSecret123!',
};

describe('facility registration emails', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    sendMailMock.mockReset();
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('responds immediately even if the mail provider never answers', async () => {
    // A hung SMTP connection used to hold the registration request open
    // indefinitely, leaving the registrant staring at a stuck form.
    sendMailMock.mockImplementation(() => new Promise(() => {}));

    const response = await app.inject({ method: 'POST', url: '/auth/register', payload: registration });

    expect(response.statusCode).toBe(200);
    expect(response.json().success).toBe(true);
  });

  it('emails the registrant a confirmation and notifies the Bulamu admin', async () => {
    sendMailMock.mockResolvedValue({ sent: true });

    const response = await app.inject({ method: 'POST', url: '/auth/register', payload: registration });
    expect(response.statusCode).toBe(200);

    const recipients = sendMailMock.mock.calls.map(([mail]) => mail.to);
    expect(recipients).toContain('grace@emailtest.ug');
    expect(recipients).toHaveLength(2);

    const confirmation = sendMailMock.mock.calls.map(([mail]) => mail).find((mail) => mail.to === 'grace@emailtest.ug');
    expect(confirmation.subject).toContain('received your Bulamu registration');
    expect(confirmation.html).toContain(response.json().facilityCode);
  });

  it('still registers the facility when the confirmation email fails to send', async () => {
    sendMailMock.mockResolvedValue({ sent: false, reason: 'SMTP unreachable' });

    const response = await app.inject({ method: 'POST', url: '/auth/register', payload: registration });

    expect(response.statusCode).toBe(200);
    expect(response.json().facilityCode).toBeTruthy();
  });
});
