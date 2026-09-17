import nodemailer, { Transporter } from 'nodemailer';

const BRAND_TEAL = '#0f766e';

// Where Bulamu-operations notifications (new registrations, new access
// requests) are sent. Overridable via env; defaults to the standing admin
// inbox so this keeps working even if the env var is never set.
export const ADMIN_NOTIFY_EMAIL = process.env.SUPER_ADMIN_NOTIFY_EMAIL || 'starplay.stargames@gmail.com';

// Inbox for user-submitted feedback specifically - the standing Bulamu
// operations mailbox rather than a personal one.
export const FEEDBACK_EMAIL = process.env.FEEDBACK_NOTIFY_EMAIL || 'admin@bulamu.site';

let transporter: Transporter | null | undefined;

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

export async function sendMail(input: {
  to: string;
  subject: string;
  html: string;
  attachments?: MailAttachment[];
}): Promise<{ sent: boolean; reason?: string }> {
  const client = getTransporter();
  if (!client) {
    return { sent: false, reason: 'SMTP not configured' };
  }

  await client.sendMail({
    from: process.env.SMTP_FROM || 'Bulamu <no-reply@bulamu.ug>',
    to: input.to,
    subject: input.subject,
    html: input.html,
    attachments: input.attachments,
  });

  return { sent: true };
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

export function facilityApprovedEmail(clinicName: string, loginUrl: string): string {
  return emailShell(`
    <h2 style="margin:0 0 12px;font-size:18px;">${clinicName} is approved</h2>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.5;">
      Your facility has been reviewed and approved on Bulamu. Your 2-week free trial has started -
      sign in to start registering patients, booking appointments, and recording consultations.
    </p>
    <a href="${loginUrl}" style="display:inline-block;background:${BRAND_TEAL};color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:bold;">
      Sign In
    </a>
  `);
}

export function patientPortalAccountCreatedEmail(patientName: string, portableId: string, clinicName: string, setPasswordUrl: string): string {
  return emailShell(`
    <h2 style="margin:0 0 12px;font-size:18px;">Your Bulamu patient account</h2>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.5;">
      ${clinicName} created a Bulamu portal account for ${patientName}. Your Patient ID is:
    </p>
    <p style="margin:0 0 20px;font-size:20px;font-weight:bold;letter-spacing:1px;color:${BRAND_TEAL};">${portableId}</p>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.5;">
      Keep this ID - any Bulamu facility you visit can use it to link your visit there once you approve it.
      Set your password to finish activating your account. This link expires in 1 hour.
    </p>
    <a href="${setPasswordUrl}" style="display:inline-block;background:${BRAND_TEAL};color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:bold;">
      Set Password
    </a>
  `);
}

export function facilityRejectedEmail(clinicName: string, reason: string | undefined): string {
  return emailShell(`
    <h2 style="margin:0 0 12px;font-size:18px;">${clinicName} was not approved</h2>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.5;">
      After review, we were unable to approve this facility's registration on Bulamu${reason ? `: <strong>${reason}</strong>` : '.'}
    </p>
    <p style="margin:0;font-size:13px;color:#64748b;">
      If you believe this is a mistake or have questions, please contact Bulamu support.
    </p>
  `);
}

export function facilityPendingApprovalEmail(clinicName: string, facilityCode: string, consoleUrl: string): string {
  return emailShell(`
    <h2 style="margin:0 0 12px;font-size:18px;">New facility awaiting approval</h2>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.5;">
      <strong>${clinicName}</strong> (Facility ID: ${facilityCode}) just submitted a registration and is
      waiting for review in Facility Management.
    </p>
    <a href="${consoleUrl}" style="display:inline-block;background:${BRAND_TEAL};color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:bold;">
      Review facility
    </a>
  `);
}

export function newAccessRequestEmail(facilityName: string, contactPerson: string, phone: string, email: string): string {
  return emailShell(`
    <h2 style="margin:0 0 12px;font-size:18px;">New evaluation access request</h2>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.5;">
      <strong>${facilityName}</strong> requested evaluation access.<br/>
      Contact: ${contactPerson} - ${phone} - ${email}
    </p>
  `);
}

export function feedbackSubmittedEmail(authorName: string, authorRole: string, clinicName: string, body: string): string {
  return emailShell(`
    <h2 style="margin:0 0 12px;font-size:18px;">New feedback submitted</h2>
    <p style="margin:0 0 8px;font-size:13px;color:#64748b;">
      ${authorName} (${authorRole}) - ${clinicName}
    </p>
    <p style="margin:0;font-size:14px;line-height:1.5;white-space:pre-wrap;">${body}</p>
  `);
}

export function newCommentEmail(authorName: string, authorRole: string, entityType: string, body: string, consoleUrl: string): string {
  return emailShell(`
    <h2 style="margin:0 0 12px;font-size:18px;">New note on a ${entityType.toLowerCase()} record</h2>
    <p style="margin:0 0 8px;font-size:13px;color:#64748b;">${authorName} (${authorRole})</p>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.5;white-space:pre-wrap;">${body}</p>
    <a href="${consoleUrl}" style="display:inline-block;background:${BRAND_TEAL};color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:bold;">
      Open Bulamu
    </a>
  `);
}

export function subscriptionReceiptEmail(clinicName: string, amount: number, currency: string, periodEnd: Date): string {
  return emailShell(`
    <h2 style="margin:0 0 12px;font-size:18px;">Payment received</h2>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.5;">
      Thank you - we've received <strong>${currency} ${amount.toLocaleString()}</strong> for ${clinicName}'s
      Bulamu subscription. Your subscription is active through <strong>${periodEnd.toLocaleDateString()}</strong>.
    </p>
    <p style="margin:0;font-size:13px;color:#64748b;">
      A PDF receipt is attached for your records.
    </p>
  `);
}
