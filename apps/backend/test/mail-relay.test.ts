import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';

// Exercises the real mailer (nothing mocked) against a local stand-in for the
// website mail bridge. SMTP points at a closed local port, which is how the
// blocked SMTP ports on Render's free plan look from the inside: the
// connection simply can't be made. Nothing here touches a real mail server.

type Captured = { body: any; message: string };
let captured: Captured[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: { ok: true } };
let server: http.Server;
let relayUrl = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const body = JSON.parse(raw);
      captured.push({ body, message: Buffer.from(body.message, 'base64').toString('utf8') });
      res.writeHead(reply.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  relayUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mail-relay.php`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const SMTP_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'MAIL_RELAY_URL', 'MAIL_TRANSPORT'];

async function loadMailer(env: Record<string, string>) {
  for (const key of SMTP_KEYS) delete process.env[key];
  Object.assign(process.env, {
    SMTP_HOST: '127.0.0.1', SMTP_PORT: '1', SMTP_SECURE: 'false',
    SMTP_USER: 'admin@bulamu.site', SMTP_PASSWORD: 'mailbox-password', SMTP_FROM: 'Bulamu <admin@bulamu.site>',
    MAIL_RELAY_URL: relayUrl,
    ...env,
  });
  vi.resetModules();
  return import('../src/lib/mailer');
}

afterEach(() => {
  captured = [];
  reply = { status: 200, body: { ok: true } };
  for (const key of SMTP_KEYS) delete process.env[key];
  vi.resetModules();
});

describe('email delivery when SMTP is blocked', () => {
  it('falls back to the website bridge when the mail server cannot be reached, and keeps using it', async () => {
    const mailer = await loadMailer({});
    const attachment = { filename: 'receipt.pdf', content: Buffer.from('%PDF-1.4 test'), contentType: 'application/pdf' };

    const first = await mailer.sendMail({ to: 'owner@clinic.ug', subject: 'Facility approved', html: '<p>Hello</p>', attachments: [attachment] });
    expect(first).toEqual({ sent: true, via: 'relay' });

    expect(captured).toHaveLength(1);
    const { body, message } = captured[0];
    expect(body).toMatchObject({ user: 'admin@bulamu.site', pass: 'mailbox-password', from: 'admin@bulamu.site', to: ['owner@clinic.ug'] });
    // The bridge receives the complete message, attachment included.
    expect(message).toContain('Subject: Facility approved');
    expect(message).toContain('filename=receipt.pdf');
    expect(message).toContain('\r\n'); // SMTP line endings

    // Once SMTP is known to be blocked, later emails go straight to the bridge.
    const started = Date.now();
    const second = await mailer.sendMail({ to: 'starplay.stargames@gmail.com, ops@bulamu.site', subject: 'Payment received', html: '<p>x</p>' });
    expect(second).toEqual({ sent: true, via: 'relay' });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(captured[1].body.to).toEqual(['starplay.stargames@gmail.com', 'ops@bulamu.site']);

    const status = mailer.mailStatus();
    expect(status.route).toBe('relay');
    expect(status.recent.map((d) => d.subject)).toEqual(['Payment received', 'Facility approved']);
    expect(status.recentSent).toBe(2);
  });

  it('reports the bridge\'s reason when it cannot deliver, and records the failure', async () => {
    const mailer = await loadMailer({ MAIL_TRANSPORT: 'relay' });
    reply = { status: 401, body: { ok: false, error: 'Sign-in to the mail server failed: 535 authentication failed' } };

    const result = await mailer.sendMail({ to: 'x@y.ug', subject: 'Test', html: '<p>x</p>' });
    expect(result).toEqual({ sent: false, via: 'relay', reason: 'Sign-in to the mail server failed: 535 authentication failed' });
    expect(mailer.mailStatus().recent[0]).toMatchObject({ sent: false, subject: 'Test' });
    expect(mailer.mailStatus().recentFailed).toBe(1);
  });

  it('reports an unreachable bridge instead of throwing', async () => {
    const mailer = await loadMailer({ MAIL_TRANSPORT: 'relay', MAIL_RELAY_URL: 'http://127.0.0.1:1/mail-relay.php' });
    const result = await mailer.sendMail({ to: 'x@y.ug', subject: 'Test', html: '<p>x</p>' });
    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/Mail bridge unreachable/);
  });

  it('does not use the bridge when forced to SMTP only', async () => {
    const mailer = await loadMailer({ MAIL_TRANSPORT: 'smtp' });
    const result = await mailer.sendMail({ to: 'x@y.ug', subject: 'Test', html: '<p>x</p>' });
    expect(result).toMatchObject({ sent: false, via: 'smtp' });
    expect(captured).toHaveLength(0);
  });

  it('sends nothing at all when email is not configured', async () => {
    const mailer = await loadMailer({});
    delete process.env.SMTP_HOST;
    const result = await mailer.sendMail({ to: 'x@y.ug', subject: 'Test', html: '<p>x</p>' });
    expect(result).toEqual({ sent: false, reason: 'SMTP not configured' });
    expect(captured).toHaveLength(0);
  });
});

describe('email content', () => {
  it('escapes anything a user typed, so a name or message cannot inject HTML', async () => {
    const mailer = await loadMailer({});
    const html = mailer.feedbackSubmittedEmail('<b>Eve</b>', 'ADMIN', 'Clinic "A"', '<a href="https://evil.example">click</a>');
    expect(html).not.toContain('<a href="https://evil.example">');
    expect(html).toContain('&lt;a href=&quot;https://evil.example&quot;&gt;click&lt;/a&gt;');
    expect(html).toContain('&lt;b&gt;Eve&lt;/b&gt;');

    const alert = mailer.operatorAlertEmail({ heading: 'New facility', facts: [['Facility', '<script>x</script>'], ['Empty', ''], ['Missing', null]] });
    expect(alert).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(alert).not.toContain('Missing');
  });

  it('writes dates the way Ugandan readers expect', async () => {
    const mailer = await loadMailer({});
    expect(mailer.formatEmailDate(new Date('2026-10-23T22:30:00Z'))).toBe('24 October 2026'); // already the 24th in Kampala
  });
});
