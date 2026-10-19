import nodemailer, { SendMailOptions, Transporter } from 'nodemailer';
import { BULAMU_LOGO_PNG } from './brand-logo';

const BRAND_TEAL = '#0f766e';
const BRAND_DARK = '#115e59';

/** Demo accounts' addresses: placeholders that must never be emailed. */
export const DEMO_EMAIL_DOMAIN = 'demo.bulamu.site';
const isDemoAddress = (to: string) => to.split(',').some((a) => a.trim().toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`));

// Where Bulamu-operations notifications (new registrations, approvals,
// payments, access requests...) are sent. Overridable via env (comma-separated
// for several inboxes); defaults to the standing operator inbox so this keeps
// working even if the env var is never set.
export const ADMIN_NOTIFY_EMAIL = process.env.SUPER_ADMIN_NOTIFY_EMAIL || 'starplay.stargames@gmail.com';

// Inbox for user-submitted feedback specifically - the standing Bulamu
// operations mailbox rather than a personal one.
export const FEEDBACK_EMAIL = process.env.FEEDBACK_NOTIFY_EMAIL || 'admin@bulamu.site';

/**
 * The HTTPS mail bridge on the Bulamu website (apps/frontend/public/mail-relay.php).
 *
 * Render's free plan blocks outbound SMTP (ports 25, 465 and 587) since
 * September 2025, so from there a direct SMTP connection just times out and
 * no email is ever delivered. The bridge runs on the Hostinger site, receives
 * the fully built message over HTTPS and hands it to the same Hostinger mailbox
 * over SMTP. It holds no secrets of its own: the mailbox login travels with each
 * request (over TLS) and it only accepts this domain's mailboxes.
 */
const MAIL_RELAY_URL = process.env.MAIL_RELAY_URL || 'https://bulamu.site/mail-relay.php';

// 'auto' (default): try SMTP, and if the connection itself cannot be made,
// use the bridge for the rest of this process. 'smtp' or 'relay' force one.
const MAIL_TRANSPORT = (process.env.MAIL_TRANSPORT || 'auto').toLowerCase();

let transporter: Transporter | null | undefined;
let directSmtpBlocked = false;

/**
 * Generic SMTP sender - works with any provider (Hostinger email hosting,
 * Gmail, SendGrid/Mailgun/Postmark's SMTP relay, etc.) so this isn't locked
 * to one vendor before a choice is made. Lazily built and cached; returns
 * null when SMTP isn't configured so callers can no-op instead of crashing -
 * mirrors the existing pattern in auth.routes.ts that logs the password
 * reset link instead of emailing it until a provider is wired up.
 */
function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) {
    transporter = null;
    return null;
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    // nodemailer's defaults (2 min connect, 10 min socket) let one unreachable
    // SMTP server pin a request open for minutes - fail fast instead.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

export function isMailConfigured(): boolean {
  return getTransporter() !== null;
}

export type MailAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
  /** Set for an image shown inside the email (referenced as cid:...), not offered as a download. */
  cid?: string;
};

/**
 * Every caller in this codebase treats email as a best-effort side channel
 * on top of a primary action (approve a facility, create a portal account,
 * reset a password) - a provider hiccup (rate limit, network blip, auth
 * failure) must never fail that primary action. Catches internally and
 * reports failure through the return value instead of throwing.
 */
export type MailResult = { sent: boolean; reason?: string; via?: 'smtp' | 'relay' };

export async function sendMail(input: {
  to: string;
  subject: string;
  html: string;
  attachments?: MailAttachment[];
}): Promise<MailResult> {
  if (isDemoAddress(input.to)) {
    const result: MailResult = { sent: false, reason: 'Demo address - demos never send email' };
    logDelivery(input, result);
    return result;
  }

  const client = getTransporter();
  if (!client) {
    const result: MailResult = { sent: false, reason: 'SMTP not configured' };
    logDelivery(input, result);
    return result;
  }

  const message = {
    from: process.env.SMTP_FROM || 'Bulamu <no-reply@bulamu.ug>',
    to: input.to,
    subject: input.subject,
    html: input.html,
    attachments: withInlineLogo(input.html, input.attachments),
  };

  let result: MailResult;
  if (MAIL_TRANSPORT === 'relay' || (MAIL_TRANSPORT === 'auto' && directSmtpBlocked)) {
    result = await sendViaRelay(message);
  } else {
    try {
      await client.sendMail(message);
      result = { sent: true, via: 'smtp' };
    } catch (error: any) {
      if (MAIL_TRANSPORT === 'auto' && isConnectionFailure(error)) {
        // The mail server could not even be reached (no SMTP conversation
        // happened, so nothing can have been sent twice): use the bridge now
        // and for every later email from this process.
        directSmtpBlocked = true;
        result = await sendViaRelay(message);
      } else {
        result = { sent: false, via: 'smtp', reason: error.message };
      }
    }
  }
  logDelivery(input, result);
  return result;
}

// Every Bulamu email shows the logo in its header; it goes along inside the message.
function withInlineLogo(html: string, attachments: MailAttachment[] = []): MailAttachment[] | undefined {
  const logo = html.includes(`cid:${LOGO_CID}`)
    ? [{ filename: 'bulamu.png', content: BULAMU_LOGO_PNG, contentType: 'image/png', cid: LOGO_CID }]
    : [];
  const all = [...logo, ...attachments];
  return all.length ? all : undefined;
}

// Only failures to open the connection - never one that happened mid-conversation.
function isConnectionFailure(error: any): boolean {
  return ['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'EDNS'].includes(error?.code) && (!error.command || error.command === 'CONN');
}

// Builds the complete message (headers, HTML, attachments) exactly as SMTP
// would send it, and posts it to the bridge.
async function sendViaRelay(message: SendMailOptions): Promise<MailResult> {
  try {
    const built = await nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' }).sendMail(message);
    const response = await fetch(MAIL_RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Bulamu-API/1.0' },
      body: JSON.stringify({
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
        from: built.envelope.from,
        to: built.envelope.to,
        message: (built.message as Buffer).toString('base64'),
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(45_000),
    });
    const body = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (response.ok && body?.ok) return { sent: true, via: 'relay' };
    return { sent: false, via: 'relay', reason: body?.error || `Mail bridge answered HTTP ${response.status}` };
  } catch (error: any) {
    return { sent: false, via: 'relay', reason: `Mail bridge unreachable: ${error?.message}` };
  }
}

// --- Delivery log -----------------------------------------------------------
// The last few deliveries, in memory, so the operator can see on the System
// page whether emails are actually going out (and why not). Resets on restart.

export type DeliveryRecord = { at: string; to: string; subject: string; sent: boolean; via?: string; reason?: string };
const DELIVERY_LOG_SIZE = 50;
const deliveryLog: DeliveryRecord[] = [];

function logDelivery(input: { to: string; subject: string }, result: MailResult) {
  deliveryLog.unshift({ at: new Date().toISOString(), to: input.to, subject: input.subject, sent: result.sent, via: result.via, reason: result.reason });
  deliveryLog.length = Math.min(deliveryLog.length, DELIVERY_LOG_SIZE);
  if (!result.sent) console.warn(`Email "${input.subject}" to ${input.to} not sent: ${result.reason}`);
}

export function mailStatus() {
  const sent = deliveryLog.filter((d) => d.sent).length;
  return {
    configured: isMailConfigured(),
    mode: MAIL_TRANSPORT,
    route: MAIL_TRANSPORT === 'relay' || directSmtpBlocked ? 'relay' : MAIL_TRANSPORT === 'smtp' ? 'smtp' : 'smtp, falling back to the bridge',
    relayUrl: MAIL_RELAY_URL,
    operatorInbox: ADMIN_NOTIFY_EMAIL,
    recent: deliveryLog.slice(0, 20),
    recentSent: sent,
    recentFailed: deliveryLog.length - sent,
  };
}

/** For tests only. */
export function resetMailState() {
  transporter = undefined;
  directSmtpBlocked = false;
  deliveryLog.length = 0;
}

/** Escape anything typed by a user before it goes into an email's HTML. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- Email design -------------------------------------------------------------
// One look for every email: a dark header with the Bulamu mark, a teal accent
// line, an eyebrow and heading, and a footer that says who sent it and why.
// Inline styles and tables only - that is what email clients render reliably.

export const TAGLINE = 'Transforming patient care.';
const SITE = 'https://bulamu.site';
/** The logo travels inside each email (Content-ID), so it shows even where remote images are blocked. */
export const LOGO_CID = 'bulamu-logo';

const INK = '#0b1f1c';
const TEXT = '#1f2a37';
const MUTED = '#4b5563';
const FAINT = '#6b7280';
const TINT = '#f0fdfa';
const TINT_LINE = '#99f6e4';
const MONO = "'IBM Plex Mono',Consolas,'Courier New',monospace";

const P = `margin:0 0 14px;font-size:15px;line-height:1.65;color:${TEXT}`;
const SMALL = `margin:0 0 12px;font-size:13px;line-height:1.6;color:${MUTED}`;

function heading(text: string): string {
  return `<h1 style="margin:0 0 18px;font-size:24px;line-height:1.3;font-weight:800;letter-spacing:-0.3px;color:${INK}">${text}</h1>`;
}

function para(html: string): string {
  return `<p style="${P}">${html}</p>`;
}

function note(html: string): string {
  return `<p style="${SMALL}">${html}</p>`;
}

function button(href: string, label: string, variant: 'primary' | 'outline' = 'primary'): string {
  const look = variant === 'primary'
    ? `background:${BRAND_TEAL};color:#ffffff;border:1px solid ${BRAND_TEAL}`
    : `background:#ffffff;color:${BRAND_TEAL};border:1px solid ${BRAND_TEAL}`;
  return `<a href="${href}" style="display:inline-block;${look};font-size:15px;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:10px" target="_blank">${label}</a>`;
}

/** The main action, centred, with room around it. */
function action(href: string, label: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:10px 0 26px">${button(href, label)}</td></tr></table>`;
}

/** A one-time code or ID, large and easy to read out. */
function codeBox(value: string, caption?: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 22px"><tr><td align="center" style="background:${TINT};border:1px solid ${TINT_LINE};border-radius:12px;padding:18px 12px">
    <span style="font-family:${MONO};font-size:28px;font-weight:700;letter-spacing:6px;color:${BRAND_DARK}">${value}</span>
    ${caption ? `<div style="margin-top:6px;font-size:12px;color:${FAINT}">${caption}</div>` : ''}
  </td></tr></table>`;
}

/** Label / value rows, e.g. a facility's details. Values must already be escaped. */
function factsTable(rows: Array<[string, string]>): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;border:1px solid #e5e7eb;border-radius:12px;border-collapse:separate">
    ${rows.map(([label, value], i) => `<tr>
      <td style="padding:10px 14px;font-size:13px;color:${FAINT};vertical-align:top;white-space:nowrap;width:1%;${i ? 'border-top:1px solid #f1f3f5;' : ''}">${label}</td>
      <td style="padding:10px 14px;font-size:14px;color:${INK};${i ? 'border-top:1px solid #f1f3f5;' : ''}">${value}</td>
    </tr>`).join('')}
  </table>`;
}

/** A tinted aside with a teal edge, for what the reader should keep in mind. */
function callout(html: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 22px"><tr>
    <td style="background:${TINT};border-left:4px solid #14b8a6;border-radius:8px;padding:14px 16px;font-size:13px;line-height:1.6;color:${MUTED}">${html}</td>
  </tr></table>`;
}

const SIGN_OFF = `<p style="margin:22px 0 0;font-size:15px;line-height:1.6;color:${TEXT}">Warm regards,<br/><strong style="color:${INK}">The Bulamu team</strong></p>`;

function emailShell(bodyHtml: string, options: { preheader?: string; eyebrow?: string; footnote?: string } = {}): string {
  const { preheader, eyebrow, footnote = 'You received this email because of your account with Bulamu.' } = options;
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="color-scheme" content="light"/></head>
<body style="margin:0;padding:0;background:#eef4f2;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${TEXT}">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef4f2">
    <tr><td align="center" style="padding:32px 12px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden">
        <tr><td style="background:#042f2e;padding:22px 32px">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle"><img src="cid:${LOGO_CID}" width="40" height="40" alt="Bulamu" style="display:block;border:0;border-radius:10px"/></td>
            <td style="vertical-align:middle;padding-left:12px">
              <div style="font-size:20px;font-weight:800;letter-spacing:-0.3px;color:#ffffff">Bulamu</div>
              <div style="font-size:12px;letter-spacing:0.2px;color:#5eead4">${TAGLINE}</div>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="height:4px;background:#14b8a6;line-height:4px;font-size:0">&nbsp;</td></tr>
        <tr><td style="padding:34px 32px 30px">
          ${eyebrow ? `<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${BRAND_TEAL}">${eyebrow}</p>` : ''}
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:18px 32px 22px;background:#f8faf9;border-top:1px solid #edf2f0;font-size:12px;line-height:1.7;color:${FAINT}">
          <strong style="color:${INK}">Bulamu</strong> &middot; ${TAGLINE}<br/>
          <a href="${SITE}" style="color:${BRAND_TEAL};text-decoration:none">bulamu.site</a> &middot;
          <a href="mailto:admin@bulamu.site" style="color:${BRAND_TEAL};text-decoration:none">admin@bulamu.site</a> &middot;
          a product of Cruze Intelligent Systems (U) Ltd
          ${footnote ? `<br/><span style="color:#9ca3af">${footnote}</span>` : ''}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function passwordResetEmail(resetUrl: string): string {
  return emailShell(`
    ${heading('Reset your password')}
    ${para('We received a request to reset the password on your Bulamu account. Use the button below to choose a new one. The link works once, for the next hour.')}
    ${action(resetUrl, 'Choose a new password')}
    ${note("If you didn't ask for this, you can ignore this email: your password stays as it is.")}
  `, { eyebrow: 'Your account', preheader: 'Choose a new password for your Bulamu account. The link works for one hour.' });
}

// "23 October 2026" - unambiguous, unlike 10/23/2026 vs 23/10/2026.
export function formatEmailDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Kampala' });
}

/** "1 November 2026, 2:52 pm" in East Africa Time. */
export function formatEmailDateTime(date: Date): string {
  const time = date.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Kampala' }).replace(/\s?([ap])\.?m\.?/i, ' $1m').toLowerCase();
  return `${formatEmailDate(date)}, ${time}`;
}

export function registrationReceivedEmail(rawAdminName: string, rawClinicName: string, facilityCode: string): string {
  const adminName = escapeHtml(rawAdminName);
  const clinicName = escapeHtml(rawClinicName);
  return emailShell(`
    ${heading('Thank you for registering with Bulamu')}
    ${para(`Dear ${adminName},`)}
    ${para(`Thank you for registering <strong>${clinicName}</strong>. We have received your details and a member of the Bulamu team will now review them.`)}
    ${factsTable([['Facility', clinicName], ['Facility ID', `<strong>${escapeHtml(facilityCode)}</strong>`]])}
    ${para('You will be able to sign in once the review is complete. We will email you as soon as your facility is approved, and your 14-day free trial starts then.')}
    ${note('Please keep your Facility ID: quote it whenever you contact us.')}
    ${SIGN_OFF}
  `, { eyebrow: 'Registration received', preheader: `We have received ${clinicName}'s registration and will email you once it is approved.`, footnote: 'You received this because this address was used to register a facility on Bulamu. If that was not you, you can ignore it.' });
}

export function facilityApprovedEmail(
  rawClinicName: string,
  loginUrl: string,
  trialEndsAt?: Date | null,
  extra: { facilityCode?: string; adminEmail?: string; receiptAttached?: boolean } = {}
): string {
  const clinicName = escapeHtml(rawClinicName);
  const { facilityCode, adminEmail, receiptAttached = true } = extra;
  const facts: Array<[string, string]> = [['Facility', clinicName]];
  if (facilityCode) facts.push(['Facility ID', `<strong>${escapeHtml(facilityCode)}</strong>`]);
  if (adminEmail) facts.push(['Sign in with', `<span style="font-family:${MONO};font-size:13px;color:${BRAND_DARK}">${escapeHtml(adminEmail)}</span>`]);
  if (trialEndsAt) facts.push(['Free trial until', formatEmailDate(trialEndsAt)]);
  return emailShell(`
    ${heading(`Welcome to Bulamu: ${clinicName} is approved`)}
    ${para('Good news: your facility has been reviewed and approved, and your 14-day free trial has started. Sign in to add your staff, register patients, book appointments and record visits.')}
    ${factsTable(facts)}
    ${action(loginUrl, 'Sign in to Bulamu')}
    ${para('A short guided tour starts the first time you sign in, and <strong>Help &amp; FAQ</strong> in the menu answers the common questions.')}
    ${receiptAttached ? note('A receipt for your free trial is attached for your records.') : ''}
    ${note('Questions? Simply reply to this email, quoting your Facility ID.')}
    ${SIGN_OFF}
  `, { eyebrow: 'Facility approved', preheader: `${clinicName} is approved and your free trial has started.` });
}

export function patientPortalAccountCreatedEmail(rawPatientName: string, portableId: string, rawClinicName: string, setPasswordUrl: string): string {
  const patientName = escapeHtml(rawPatientName);
  const clinicName = escapeHtml(rawClinicName);
  return emailShell(`
    ${heading('Your Bulamu patient account')}
    ${para(`${clinicName} has created a Bulamu Patient Portal account for ${patientName}. In the portal you can see your records and results, add your own documents and ask for appointments.`)}
    ${codeBox(escapeHtml(portableId), 'Your Patient ID')}
    ${para('Keep this ID. Any Bulamu facility you visit can use it to link your visit there, once you approve it.')}
    ${action(setPasswordUrl, 'Set your password')}
    ${note('You will be asked to confirm the phone number you gave the facility. The link works for 72 hours.')}
  `, { eyebrow: 'Patient Portal', preheader: `${clinicName} created your Bulamu patient account. Set your password to sign in.`, footnote: 'If you were not expecting this, you can ignore it: nobody can use the account until this link is used.' });
}

export function patientAccountClosedEmail(): string {
  return emailShell(`
    ${heading('Your Patient Portal account is closed')}
    ${para('Your Bulamu Patient Portal account was closed at your request. Your email address, phone number and password have been erased from it, along with your notifications and the documents you uploaded yourself. No facility can reach your records through the account any more.')}
    ${callout("The clinical records each facility holds about you have not been removed, because facilities are required to keep them. To ask about those records, please contact the facility directly.")}
    ${note('If you did not close this account, please reply to this email straight away.')}
  `, { eyebrow: 'Patient Portal', preheader: 'Your Bulamu Patient Portal account has been closed.' });
}

export function patientPasswordResetEmail(setPasswordUrl: string): string {
  return emailShell(`
    ${heading('Reset your Patient Portal password')}
    ${para('We received a request to reset the password on your Bulamu patient account. You will be asked to confirm the phone number you gave your facility.')}
    ${action(setPasswordUrl, 'Choose a new password')}
    ${note("The link works for one hour. If you didn't ask for this, you can ignore this email.")}
  `, { eyebrow: 'Patient Portal', preheader: 'Choose a new password for your Bulamu patient account.' });
}

/** The code a patient gives a facility to approve it seeing their history from other facilities. */
export function historyShareOtpEmail(rawClinicName: string, code: string): string {
  const clinicName = escapeHtml(rawClinicName);
  return emailShell(`
    ${heading(`${clinicName} is asking to see your health history`)}
    ${para(`${clinicName} would like to see your records from the other facilities you have visited (your allergies, diagnoses, medicines, lab results and hospital stays) so they can treat you safely. Nothing is shared unless you agree.`)}
    ${para('If you agree, give this code to the staff member helping you:')}
    ${codeBox(escapeHtml(code), 'Expires in 10 minutes')}
    ${note('If you do not agree, or did not expect this, do nothing: no records will be shared. You can stop sharing at any time from the Access page of your Patient Portal.')}
  `, { eyebrow: 'Your consent', preheader: `${clinicName} is asking to see your health history. Your code expires in 10 minutes.` });
}

export function patientAccessOtpEmail(rawClinicName: string, code: string): string {
  const clinicName = escapeHtml(rawClinicName);
  return emailShell(`
    ${heading(`Confirm it's you at ${clinicName}`)}
    ${para(`${clinicName} is linking your Bulamu patient account to your visit there. If this is you, give this code to the staff member helping you:`)}
    ${codeBox(escapeHtml(code), 'Expires in 10 minutes')}
    ${note('If you did not ask for this, you can ignore this email: nothing has changed on your account.')}
  `, { eyebrow: 'Your consent', preheader: `Your code for ${clinicName}. It expires in 10 minutes.` });
}

// Notification emails never contain patient names or clinical details - they
// only say that something needs attention and link to the app, where the
// detail is shown after sign-in.
export function notificationEmail(input: { heading: string; message: string; ctaUrl: string; ctaLabel: string }): string {
  return emailShell(`
    ${heading(input.heading)}
    ${para(input.message)}
    ${action(input.ctaUrl, input.ctaLabel)}
  `, { eyebrow: 'Notification', preheader: input.message, footnote: 'You can choose which emails you receive from the Notifications page after you sign in.' });
}

export function facilityRejectedEmail(rawClinicName: string, reason: string | undefined): string {
  const clinicName = escapeHtml(rawClinicName);
  return emailShell(`
    ${heading(`About your registration for ${clinicName}`)}
    ${para('Thank you for your interest in Bulamu. After reviewing your details, we were unable to approve this registration.')}
    ${reason ? factsTable([['Reason', escapeHtml(reason)]]) : ''}
    ${para('If you think this is a mistake, or the matter can be put right, simply reply to this email. You are welcome to register again once it is resolved.')}
    ${SIGN_OFF}
  `, { eyebrow: 'Registration', preheader: `An update on the registration for ${clinicName}.` });
}

export function newAccessRequestEmail(facilityName: string, contactPerson: string, phone: string, email: string): string {
  return emailShell(`
    ${heading('New request to try Bulamu')}
    ${factsTable([['Facility', escapeHtml(facilityName)], ['Contact', escapeHtml(contactPerson)], ['Phone', escapeHtml(phone)], ['Email', escapeHtml(email)]])}
  `, { eyebrow: 'For the Bulamu team', footnote: 'Sent to the Bulamu team inbox.' });
}

export function feedbackSubmittedEmail(authorName: string, authorRole: string, clinicName: string, body: string): string {
  return emailShell(`
    ${heading('New feedback')}
    ${note(`${escapeHtml(authorName)} (${escapeHtml(authorRole)}) &middot; ${escapeHtml(clinicName)}`)}
    ${callout(`<span style="white-space:pre-wrap;color:${TEXT};font-size:14px">${escapeHtml(body)}</span>`)}
  `, { eyebrow: 'For the Bulamu team', footnote: 'Sent to the Bulamu team inbox.' });
}

/**
 * An alert to the platform operator: what happened, as a short table of facts,
 * and a link to the console. Operator alerts carry facility and account details
 * only - never patient or clinical information.
 */
export function operatorAlertEmail(input: { heading: string; intro?: string; facts: Array<[string, string | number | null | undefined]>; ctaUrl?: string; ctaLabel?: string }): string {
  const rows = input.facts
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([label, value]): [string, string] => [escapeHtml(label), escapeHtml(value)]);
  return emailShell(`
    ${heading(escapeHtml(input.heading))}
    ${input.intro ? para(escapeHtml(input.intro)) : ''}
    ${rows.length ? factsTable(rows) : ''}
    ${input.ctaUrl ? action(input.ctaUrl, escapeHtml(input.ctaLabel || 'Open Bulamu')) : ''}
  `, { eyebrow: 'For the Bulamu team', footnote: 'Sent to the Bulamu team inbox. Alerts carry facility and account details only, never patient information.' });
}

export type FacilityLetter = { adminName?: string | null; facilityCode: string; reason?: string | null };

const SUPPORT_LINE = note(`Questions? Simply reply to this email, or write to <a href="mailto:admin@bulamu.site" style="color:${BRAND_TEAL}">admin@bulamu.site</a>, quoting your Facility ID.`);

function letterOpening(letter: FacilityLetter, clinicName: string): string {
  return para(`Dear ${escapeHtml(letter.adminName || `${clinicName} administrator`)},`);
}

function letterFacts(letter: FacilityLetter, clinicName: string, effective: string): string {
  const rows: Array<[string, string]> = [['Facility', clinicName], ['Facility ID', escapeHtml(letter.facilityCode)], ['Effective', effective]];
  if (letter.reason) rows.push(['Reason', escapeHtml(letter.reason)]);
  return factsTable(rows);
}

/** Tells a facility's admin that the facility was suspended or reactivated. */
export function facilityStatusEmail(rawClinicName: string, active: boolean, loginUrl: string, letter: FacilityLetter): string {
  const clinicName = escapeHtml(rawClinicName);
  const effective = formatEmailDate(new Date());
  return active
    ? emailShell(`
    ${heading(`Access restored: ${clinicName}`)}
    ${letterOpening(letter, clinicName)}
    ${para("We are pleased to let you know that your facility's access to Bulamu has been restored. You and your staff can sign in again with your usual accounts, and all of your records are exactly as you left them.")}
    ${letterFacts(letter, clinicName, effective)}
    ${action(loginUrl, 'Sign in to Bulamu')}
    ${SUPPORT_LINE}
    ${SIGN_OFF}
  `, { eyebrow: 'Access restored', preheader: `${clinicName} can sign in to Bulamu again.` })
    : emailShell(`
    ${heading("Your facility's access has been suspended")}
    ${letterOpening(letter, clinicName)}
    ${para('We are writing to let you know that access to Bulamu has been suspended for your facility. While the suspension is in place, you and your staff will not be able to sign in.')}
    ${letterFacts(letter, clinicName, effective)}
    ${callout('Your records are kept safe and nothing has been deleted. Once the matter is resolved, access can be restored and everything will be as you left it.')}
    ${SUPPORT_LINE}
    ${SIGN_OFF}
  `, { eyebrow: 'Access suspended', preheader: `Access to Bulamu has been suspended for ${clinicName}.` });
}

/** Tells a facility's admin that the facility has been removed from Bulamu. */
export function facilityRemovedEmail(rawClinicName: string, letter: FacilityLetter): string {
  const clinicName = escapeHtml(rawClinicName);
  return emailShell(`
    ${heading('Your facility has been removed from Bulamu')}
    ${letterOpening(letter, clinicName)}
    ${para("We are writing to confirm that your facility's account on Bulamu has been closed. Staff accounts at the facility have been deactivated and can no longer sign in.")}
    ${letterFacts(letter, clinicName, formatEmailDate(new Date()))}
    ${callout("Your facility's records have not been erased. They are kept securely for the period set out in our data retention policy, as health records must be. If you need a copy of your records, or believe this was done in error, please contact us.")}
    ${SUPPORT_LINE}
    ${SIGN_OFF}
  `, { eyebrow: 'Account closed', preheader: `${clinicName}'s Bulamu account has been closed.` });
}

export function subscriptionReceiptEmail(rawClinicName: string, amount: number, currency: string, periodEnd: Date): string {
  const clinicName = escapeHtml(rawClinicName);
  return emailShell(`
    ${heading('Thank you: payment received')}
    ${para(`We have received your payment for ${clinicName}'s Bulamu subscription.`)}
    ${factsTable([['Facility', clinicName], ['Amount', `<strong>${escapeHtml(currency)} ${amount.toLocaleString()}</strong>`], ['Active until', formatEmailDate(periodEnd)]])}
    ${note('A PDF receipt is attached for your records.')}
    ${SIGN_OFF}
  `, { eyebrow: 'Payment received', preheader: `Payment received. ${clinicName}'s subscription is active until ${formatEmailDate(periodEnd)}.` });
}

/** Tells a facility's admin that the Bulamu team has given them more trial days. */
export function trialExtendedEmail(rawClinicName: string, days: number, trialEndsAt: Date, loginUrl: string): string {
  const clinicName = escapeHtml(rawClinicName);
  return emailShell(`
    ${heading(`Your free trial has been extended by ${days} day${days === 1 ? '' : 's'}`)}
    ${para(`Good news: the Bulamu team has added ${days} day${days === 1 ? '' : 's'} to ${clinicName}'s free trial, so you have more time to try everything with your team.`)}
    ${factsTable([['Facility', clinicName], ['Free trial until', `<strong>${formatEmailDate(trialEndsAt)}</strong>`]])}
    ${action(loginUrl, 'Sign in to Bulamu')}
    ${note('When you are ready, an administrator can subscribe from the Billing page. Paying early never costs you trial days.')}
    ${SIGN_OFF}
  `, { eyebrow: 'Free trial', preheader: `${clinicName}'s free trial now runs until ${formatEmailDate(trialEndsAt)}.` });
}

/** A facility's receipt to its patient, sent from the payment screen with the PDF attached. */
export function patientReceiptEmail(input: {
  clinicName: string; patientName: string; receiptNumber: string; amount: string; method: string; receivedAt: Date; balance: string | null;
}): string {
  const clinicName = escapeHtml(input.clinicName);
  return emailShell(`
    ${heading(`Your receipt from ${clinicName}`)}
    ${para(`Dear ${escapeHtml(input.patientName)}, thank you for your payment. Your receipt is attached; keep it as proof of payment.`)}
    ${factsTable([
      ['Receipt number', `<strong>${escapeHtml(input.receiptNumber)}</strong>`],
      ['Amount received', `<strong>${escapeHtml(input.amount)}</strong>`],
      ['Paid by', escapeHtml(input.method)],
      ['Date', formatEmailDateTime(input.receivedAt)],
      ['Balance', input.balance ? escapeHtml(input.balance) : 'Paid in full'],
    ])}
    ${note(`If anything on this receipt looks wrong, please contact ${clinicName} directly.`)}
  `, {
    eyebrow: 'Receipt',
    preheader: `${input.amount} received by ${clinicName}. Receipt ${input.receiptNumber}.`,
    footnote: `Sent by ${clinicName} using Bulamu. Bulamu keeps the facility's records but does not collect or hold patient payments.`,
  });
}

/** The guided tour sent with every demo: one action followed through the whole facility. */
const DEMO_TOUR: Array<{ title: string; body: string }> = [
  { title: 'Start as the administrator', body: 'The Dashboard shows the facility at a glance. Look through Staff, Wards and Invoices, then open Reports for the monthly HMIS 105 figures.' },
  { title: 'Switch to the front desk', body: 'Register a new patient under Patients, then book them in Appointments with Dr Samuel Okello for today.' },
  { title: 'Then the doctor', body: 'In Consultations, choose Record visit for your new patient: symptoms, a coded diagnosis and a prescription (try amoxicillin for Achieng Mary to see her penicillin allergy warning). Then order a Malaria RDT for them on the Lab Tests page.' },
  { title: 'Now the lab technician', body: 'Lab Tests shows the test the doctor just ordered. Enter the result; it waits for a clinician to verify it before the patient is told.' },
  { title: 'Then the pharmacist', body: 'Dispensing shows the prescription waiting. Dispense it and watch the stock go down in Inventory, next to the low-stock and expiry alerts.' },
];

const DEMO_ALSO: Array<[string, string]> = [
  ['Doctor', 'verify the haemoglobin result waiting on the Lab Tests page; once verified, it is locked.'],
  ['Nurse', 'on Wards, Achieng Mary is admitted to the Female Ward: record her observations and read the ward-round notes.'],
  ['Front desk', 'on Bills & Payments, Nalubega Faith still owes part of her bill: record the rest by mobile money and print her numbered receipt.'],
  ['Administrator', 'Finances shows today\'s takings by method and by person, and the month\'s money in against expenses; every printout carries the facility\'s name and who produced it.'],
];

export function demoFacilityEmail(input: {
  loginUrl: string;
  registerUrl: string;
  password: string;
  expiresAt: Date;
  accounts: Array<{ roleTitle: string; name: string; email: string }>;
  /** The demo patient's Patient Portal sign-in. */
  patient?: { name: string; email: string; portalUrl: string };
  /** For someone whose earlier sign-ins did not work: says sorry and that these replace them. */
  replacesEarlier?: boolean;
}): string {
  const expires = formatEmailDateTime(input.expiresAt);
  const patient = input.patient;
  const signIns = [
    ...input.accounts.map((a) => ({ ...a, where: '' })),
    ...(patient ? [{ roleTitle: 'Patient', name: patient.name, email: patient.email, where: `<div style="margin-top:3px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:${FAINT}">at the <a href="${patient.portalUrl}" style="color:${BRAND_TEAL}">Patient Portal</a></div>` }] : []),
  ];
  const tour = patient
    ? [...DEMO_TOUR, { title: 'Finish as the patient', body: `Sign in to the <a href="${patient.portalUrl}" style="color:${BRAND_TEAL}">Patient Portal</a> as ${escapeHtml(patient.name)}: her own visits, verified lab results and hospital stay, on her phone. Ask for an appointment there and it appears on the front desk's Appointments page.` }]
    : DEMO_TOUR;
  const rows = signIns.map((a, i) => `
      <tr>
        <td style="padding:10px;vertical-align:top;${i < signIns.length - 1 ? 'border-bottom:1px solid #f1f3f5;' : ''}">
          <div style="font-size:14px;font-weight:600;color:${INK}">${escapeHtml(a.roleTitle)}</div>
          <div style="font-size:12px;color:${FAINT}">${escapeHtml(a.name)}</div>
        </td>
        <td style="padding:10px;vertical-align:top;${i < signIns.length - 1 ? 'border-bottom:1px solid #f1f3f5;' : ''}font-family:${MONO};font-size:13px;color:${BRAND_DARK};word-break:break-all">${escapeHtml(a.email)}${a.where}</td>
      </tr>`).join('');
  const steps = tour.map((step, i) => `
      <tr>
        <td style="vertical-align:top;padding:0 12px 16px 0;width:26px">
          <div style="width:24px;height:24px;line-height:24px;border-radius:12px;background:${BRAND_TEAL};color:#ffffff;font-size:12px;font-weight:700;text-align:center">${i + 1}</div>
        </td>
        <td style="vertical-align:top;padding:0 0 16px">
          <div style="font-size:15px;font-weight:700;color:${INK};margin:2px 0 3px">${step.title}</div>
          <div style="font-size:14px;line-height:1.6;color:${MUTED}">${step.body}</div>
        </td>
      </tr>`).join('');
  const also = DEMO_ALSO.map(([role, text]) => `<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:${MUTED}"><span style="color:#14b8a6">&rsaquo;</span>&nbsp; <strong style="color:${INK}">${role}:</strong> ${text}</p>`).join('');

  return emailShell(`
    ${heading('Thank you for your interest in Bulamu')}
    ${para('Hello,')}
    ${input.replacesEarlier ? callout(`<strong style="color:${INK}">We are sorry: the sign-ins we sent you earlier did not work.</strong> This email replaces them. The demo below is new, set up just for you, and every sign-in in it has been checked.`) : ''}
    ${para('Thank you for taking the time to look at Bulamu. Rather than a slideshow, we have set up a working demo facility just for you, already filled with patients, visits, prescriptions, lab results, stock, wards and invoices.')}
    ${para('There is a sign-in for every role, and the short tour below walks you through it, so you can see your facility the way each person in it would: from the front desk to the pharmacy, and the patient at home.')}
    ${action(input.loginUrl, 'Open your demo')}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${TINT_LINE};border-radius:12px;background:${TINT}">
      <tr><td style="padding:18px 20px 6px">
        <p style="margin:0;font-size:16px;font-weight:700;color:${INK}">Your sign-ins</p>
        <p style="margin:6px 0 0;font-size:14px;line-height:1.55;color:${MUTED}">Every account uses the same password:</p>
        <p style="margin:8px 0 10px"><span style="display:inline-block;font-family:${MONO};font-size:17px;font-weight:600;color:${BRAND_DARK};background:#ffffff;border:1px solid ${TINT_LINE};border-radius:8px;padding:7px 14px;letter-spacing:0.3px">${escapeHtml(input.password)}</span></p>
        <p style="margin:0 0 14px;font-size:13px;line-height:1.55;color:${MUTED}">These sign-ins expire after <strong style="color:${INK}">14 days</strong>, on ${expires} (East Africa Time).</p>
      </td></tr>
      <tr><td style="padding:0 12px 12px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;border-collapse:separate">
          <tr>
            <th align="left" style="padding:10px;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${FAINT};border-bottom:1px solid #e5e7eb">Role</th>
            <th align="left" style="padding:10px;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${FAINT};border-bottom:1px solid #e5e7eb">Sign in with</th>
          </tr>
          ${rows}
        </table>
      </td></tr>
    </table>

    <p style="margin:30px 0 4px;font-size:17px;font-weight:800;color:${INK}">Your guided tour</p>
    ${note('Follow these steps in order. Each one builds on the last, so together they show how a single patient visit travels through the whole facility.')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px">${steps}</table>

    <p style="margin:8px 0 10px;font-size:15px;font-weight:700;color:${INK}">Also worth a look</p>
    ${also}
    ${note('Tip: to watch two roles side by side, sign in to the second one in a private browser window.')}

    ${callout(`This demo is yours alone: nobody else can see or change it. Your sign-ins expire after <strong style="color:${INK}">14 days, on ${expires}</strong>, and the demo then closes. Emails are never sent from inside a demo, so nothing you try there reaches anyone: each person's messages appear under Notifications instead. Every name and record in it is made up.`)}

    ${para('When you are ready to bring your own facility, registration takes a few minutes and starts with a free 14-day trial.')}
    <p style="margin:0 0 24px">${button(input.registerUrl, 'Register your facility', 'outline')}</p>
    ${para('If you have any questions, or would like us to walk you through it, simply reply to this email. We would be glad to help.')}
    ${SIGN_OFF}
  `, {
    eyebrow: 'Your demo is ready',
    preheader: 'Thank you for your interest in Bulamu. Your demo is ready, with a sign-in for every role and a short guided tour.',
    footnote: 'You received this because the Bulamu team sent you a demo. Your email address is not kept on file.',
  });
}
