import nodemailer, { SendMailOptions, Transporter } from 'nodemailer';

const BRAND_TEAL = '#0f766e';

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
    attachments: input.attachments,
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

function emailShell(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Helvetica,Arial,sans-serif;color:#1e293b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
        <tr><td style="background:${BRAND_TEAL};padding:20px 28px;">
          <span style="color:#ffffff;font-size:20px;font-weight:bold;">Bulamu</span><br/>
          <span style="color:#d1fae5;font-size:10px;letter-spacing:1px;">MEDICAL FACILITY OS</span>
        </td></tr>
        <tr><td style="padding:28px;">${bodyHtml}</td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #e2e8f0;">
          <span style="color:#64748b;font-size:11px;">Bulamu is a product of Cruze Intelligent Systems (U) Ltd.</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function passwordResetEmail(resetUrl: string): string {
  return emailShell(`
    <h2 style="margin:0 0 12px;font-size:18px;">Reset your password</h2>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.5;">
      We received a request to reset the password on your Bulamu account. This link expires in 1 hour.
    </p>
    <a href="${resetUrl}" style="display:inline-block;background:${BRAND_TEAL};color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:bold;">
      Reset Password
    </a>
    <p style="margin:20px 0 0;font-size:12px;color:#64748b;">
      If you didn't request this, you can safely ignore this email.
    </p>
  `);
}

// "23 October 2026" - unambiguous, unlike 10/23/2026 vs 23/10/2026.
export function formatEmailDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Kampala' });
}

export function registrationReceivedEmail(rawAdminName: string, rawClinicName: string, facilityCode: string): string {
  const adminName = escapeHtml(rawAdminName);
  const clinicName = escapeHtml(rawClinicName);
  return emailShell(`
    <h2 style="margin:0 0 12px;font-size:18px;">We have received your registration</h2>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.5;">
      Dear ${adminName}, thank you for registering <strong>${clinicName}</strong> on Bulamu.
    </p>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.5;">
      Your Facility ID is <strong>${facilityCode}</strong>. Please keep it for your records.
    </p>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.5;">
      A Bulamu administrator will now review your details. You will not be able to sign in until the review is
      complete. As soon as your facility is approved, we will email you and your 2-week free trial will begin.
    </p>
    <p style="margin:0;font-size:12px;color:#64748b;">
      If you did not register a facility on Bulamu, you can safely ignore this email.
    </p>
  `);
}

export function facilityApprovedEmail(
  rawClinicName: string,
  loginUrl: string,
  trialEndsAt?: Date | null,
  extra: { facilityCode?: string; adminEmail?: string; receiptAttached?: boolean } = {}
): string {
  const clinicName = escapeHtml(rawClinicName);
  const { facilityCode, adminEmail, receiptAttached = true } = extra;
  return emailShell(`
    <h2 style="margin:0 0 12px;font-size:18px;">${clinicName} is approved</h2>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.5;">
      Your facility has been reviewed and approved on Bulamu. Your 2-week free trial has started${trialEndsAt ? ` and runs through <strong>${formatEmailDate(trialEndsAt)}</strong>` : ''} -
      sign in to start registering patients, booking appointments, and recording consultations.
      ${receiptAttached ? 'A receipt for your free trial is attached for your records.' : ''}
    </p>
    ${facilityCode || adminEmail ? `<p style="margin:0 0 20px;font-size:14px;line-height:1.5;">
      ${facilityCode ? `Facility ID: <strong>${escapeHtml(facilityCode)}</strong><br/>` : ''}
      ${adminEmail ? `Sign in with: <strong>${escapeHtml(adminEmail)}</strong>` : ''}
    </p>` : ''}
    <a href="${loginUrl}" style="display:inline-block;background:${BRAND_TEAL};color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:bold;">
      Sign In
    </a>
  `);
}

export function patientPortalAccountCreatedEmail(rawPatientName: string, portableId: string, rawClinicName: string, setPasswordUrl: string): string {
  const patientName = escapeHtml(rawPatientName);
  const clinicName = escapeHtml(rawClinicName);
  return emailShell(`
    <h2 style="margin:0 0 12px;font-size:18px;">Your Bulamu patient account</h2>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.5;">
      ${clinicName} created a Bulamu portal account for ${patientName}. Your Patient ID is:
    </p>
    <p style="margin:0 0 20px;font-size:20px;font-weight:bold;letter-spacing:1px;color:${BRAND_TEAL};">${portableId}</p>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.5;">
      Keep this ID - any Bulamu facility you visit can use it to link your visit there once you approve it.
      Use the button below to set your password and sign in to the Patient Portal, where you can view your
      records, upload documents and request appointments. You will be asked to confirm the phone number you gave
      the facility. This link expires in 72 hours.
    </p>
    <a href="${setPasswordUrl}" style="display:inline-block;background:${BRAND_TEAL};color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:bold;">
      Set Password
    </a>
    <p style="margin:20px 0 0;font-size:12px;color:#64748b;">
      If you were not expecting this email, you can safely ignore it - no one can access your account until this
      link is used.
    </p>
  `);
}

export function patientAccountClosedEmail(): string {
  return emailShell(`
    <h2 style="margin:0 0 12px;font-size:18px;">Your Patient Portal account has been closed</h2>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.5;">
      Your Bulamu Patient Portal account was closed at your request. Your email address, phone number and password
      have been erased from the account, along with your notifications and any documents you uploaded yourself, and
      no facility can access your records through the account any more.
    </p>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.5;">
      The clinical records that each facility holds about you have not been removed, because facilities are required
      to keep them. To ask about those records, please contact the facility directly.
    </p>
    <p style="margin:0;font-size:12px;color:#64748b;">
      If you did not close this account, please contact Bulamu support straight away.
    </p>
  `);
}

export function patientPasswordResetEmail(setPasswordUrl: string): string {
  return emailShell(`
    <h2 style="margin:0 0 12px;font-size:18px;">Reset your Patient Portal password</h2>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.5;">
      We received a request to reset the password on your Bulamu patient account. You will be asked to confirm the
      phone number you gave your facility. This link expires in 1 hour.
    </p>
    <a href="${setPasswordUrl}" style="display:inline-block;background:${BRAND_TEAL};color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:bold;">
      Reset Password
    </a>
    <p style="margin:20px 0 0;font-size:12px;color:#64748b;">
      If you did not request this, you can safely ignore this email.
    </p>
  `);
}

export function patientAccessOtpEmail(rawClinicName: string, code: string): string {
  const clinicName = escapeHtml(rawClinicName);
  return emailShell(`
    <h2 style="margin:0 0 12px;font-size:18px;">Confirm your identity at ${clinicName}</h2>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.5;">
      ${clinicName} is asking to link your Bulamu patient account to a visit there. If this is you, share this
      code with the staff member helping you. This code expires in 10 minutes.
    </p>
    <p style="margin:0 0 20px;font-size:28px;font-weight:bold;letter-spacing:4px;color:${BRAND_TEAL};">${code}</p>
    <p style="margin:0;font-size:13px;color:#64748b;">
      If you did not request this, you can safely ignore this email - no changes were made to your account.
    </p>
  `);
}

// Notification emails never contain patient names or clinical details - they
// only say that something needs attention and link to the app, where the
// detail is shown after sign-in.
export function notificationEmail(input: { heading: string; message: string; ctaUrl: string; ctaLabel: string }): string {
  return emailShell(`
    <h2 style="margin:0 0 12px;font-size:18px;">${input.heading}</h2>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.5;">${input.message}</p>
    <a href="${input.ctaUrl}" style="display:inline-block;background:${BRAND_TEAL};color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:bold;">
      ${input.ctaLabel}
    </a>
    <p style="margin:20px 0 0;font-size:12px;color:#64748b;">
      You can choose which notification emails you receive from the Notifications page after you sign in.
    </p>
  `);
}

export function facilityRejectedEmail(rawClinicName: string, reason: string | undefined): string {
  const clinicName = escapeHtml(rawClinicName);
  return emailShell(`
    <h2 style="margin:0 0 12px;font-size:18px;">${clinicName} was not approved</h2>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.5;">
      After review, we were unable to approve this facility's registration on Bulamu${reason ? `: <strong>${escapeHtml(reason)}</strong>` : '.'}
    </p>
    <p style="margin:0;font-size:13px;color:#64748b;">
      If you believe this is a mistake or have questions, please contact Bulamu support.
    </p>
  `);
}

export function newAccessRequestEmail(facilityName: string, contactPerson: string, phone: string, email: string): string {
  return emailShell(`
    <h2 style="margin:0 0 12px;font-size:18px;">New evaluation access request</h2>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.5;">
      <strong>${escapeHtml(facilityName)}</strong> requested evaluation access.<br/>
      Contact: ${escapeHtml(contactPerson)} - ${escapeHtml(phone)} - ${escapeHtml(email)}
    </p>
  `);
}

export function feedbackSubmittedEmail(authorName: string, authorRole: string, clinicName: string, body: string): string {
  return emailShell(`
    <h2 style="margin:0 0 12px;font-size:18px;">New feedback submitted</h2>
    <p style="margin:0 0 8px;font-size:13px;color:#64748b;">
      ${escapeHtml(authorName)} (${escapeHtml(authorRole)}) - ${escapeHtml(clinicName)}
    </p>
    <p style="margin:0;font-size:14px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(body)}</p>
  `);
}

/**
 * An alert to the platform operator: what happened, as a short table of facts,
 * and a link to the console. Operator alerts carry facility and account details
 * only - never patient or clinical information.
 */
export function operatorAlertEmail(input: { heading: string; intro?: string; facts: Array<[string, string | number | null | undefined]>; ctaUrl?: string; ctaLabel?: string }): string {
  const rows = input.facts
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([label, value]) => `
      <tr>
        <td style="padding:6px 12px 6px 0;font-size:13px;color:#64748b;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td>
        <td style="padding:6px 0;font-size:13px;color:#1e293b;">${escapeHtml(value)}</td>
      </tr>`)
    .join('');
  return emailShell(`
    <h2 style="margin:0 0 12px;font-size:18px;">${escapeHtml(input.heading)}</h2>
    ${input.intro ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;">${escapeHtml(input.intro)}</p>` : ''}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-collapse:collapse;">${rows}</table>
    ${input.ctaUrl ? `<a href="${input.ctaUrl}" style="display:inline-block;background:${BRAND_TEAL};color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:bold;">
      ${escapeHtml(input.ctaLabel || 'Open Bulamu')}
    </a>` : ''}
  `);
}

/** Tells a facility's admin that the facility was suspended or reactivated. */
export function facilityStatusEmail(rawClinicName: string, active: boolean, loginUrl: string): string {
  const clinicName = escapeHtml(rawClinicName);
  return emailShell(active ? `
    <h2 style="margin:0 0 12px;font-size:18px;">${clinicName} has been reactivated</h2>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.5;">
      Access to Bulamu has been restored for your facility. You and your staff can sign in again.
    </p>
    <a href="${loginUrl}" style="display:inline-block;background:${BRAND_TEAL};color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:bold;">
      Sign In
    </a>
  ` : `
    <h2 style="margin:0 0 12px;font-size:18px;">${clinicName} has been suspended</h2>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.5;">
      Access to Bulamu has been paused for your facility, so you and your staff cannot sign in for now.
      Your records are kept safe and nothing has been deleted.
    </p>
    <p style="margin:0;font-size:13px;color:#64748b;">
      If you were not expecting this, or to have access restored, please contact Bulamu support by replying to this email.
    </p>
  `);
}

export function subscriptionReceiptEmail(rawClinicName: string, amount: number, currency: string, periodEnd: Date): string {
  const clinicName = escapeHtml(rawClinicName);
  return emailShell(`
    <h2 style="margin:0 0 12px;font-size:18px;">Payment received</h2>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.5;">
      Thank you - we've received <strong>${currency} ${amount.toLocaleString()}</strong> for ${clinicName}'s
      Bulamu subscription. Your subscription is active through <strong>${formatEmailDate(periodEnd)}</strong>.
    </p>
    <p style="margin:0;font-size:13px;color:#64748b;">
      A PDF receipt is attached for your records.
    </p>
  `);
}
