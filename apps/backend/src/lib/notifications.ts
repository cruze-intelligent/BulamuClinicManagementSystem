import { NotificationType, Role } from '@prisma/client';
import { prisma } from './prisma';
import { sendMail, notificationEmail } from './mailer';

/**
 * Who is told about what - the single place to read (and change) which
 * notifications each role receives and which of them also arrive by email.
 *
 * - `roles`: staff roles that get the in-app notification (a facility's own
 *   staff only - never another facility's).
 * - `emailRoles`: the subset of those roles that also get an email. Anything
 *   high-volume stays in-app only, so email is reserved for things that
 *   genuinely need attention. Recipients can switch each email type off.
 * - patient types are sent to the patient's own portal account.
 * - `emailSubject`: the fixed, generic subject and heading used for the email.
 *   The in-app title/body may name patients or medicines; an email never does, so
 *   it can't be built from them.
 */
type StaffRule = {
  audience: 'STAFF';
  emailSubject: string;
  label: string;
  description: string;
  roles: Role[];
  emailRoles: Role[];
};
type PatientRule = {
  audience: 'PATIENT';
  emailSubject: string;
  label: string;
  description: string;
  email: boolean;
};
export type NotificationRule = StaffRule | PatientRule;

export const NOTIFICATION_RULES: Record<NotificationType, NotificationRule> = {
  LAB_RESULT_READY: {
    audience: 'PATIENT', email: true,
    emailSubject: 'Your lab results are ready',
    label: 'Lab results ready',
    description: 'When a lab result for you has been recorded.',
  },
  LOW_STOCK: {
    audience: 'STAFF', roles: ['PHARMACIST', 'ADMIN'], emailRoles: ['PHARMACIST', 'ADMIN'],
    emailSubject: 'Restock needed',
    label: 'Low stock (restock needed)',
    description: 'When a medicine falls to or below its reorder level.',
  },
  NEW_PRESCRIPTION: {
    audience: 'STAFF', roles: ['PHARMACIST'], emailRoles: [],
    emailSubject: 'New prescription to dispense',
    label: 'New prescriptions',
    description: 'When a consultation includes prescriptions to dispense. In-app only.',
  },
  APPOINTMENT_REQUESTED: {
    audience: 'STAFF', roles: ['STAFF', 'NURSE', 'ADMIN'], emailRoles: ['STAFF', 'ADMIN'],
    emailSubject: 'New appointment request',
    label: 'Appointment requests',
    description: 'When a patient requests an appointment through the Patient Portal.',
  },
  APPOINTMENT_CONFIRMED: {
    audience: 'PATIENT', email: true,
    emailSubject: 'Your appointment is confirmed',
    label: 'Appointment confirmed',
    description: 'When the facility confirms an appointment you requested.',
  },
  APPOINTMENT_DECLINED: {
    audience: 'PATIENT', email: true,
    emailSubject: 'Update on your appointment request',
    label: 'Appointment declined',
    description: 'When the facility is unable to accept an appointment you requested.',
  },
  REFERRAL_RECEIVED: {
    audience: 'STAFF', roles: ['ADMIN', 'DOCTOR'], emailRoles: ['ADMIN', 'DOCTOR'],
    emailSubject: 'New referral received',
    label: 'Referrals received',
    description: 'When another facility refers a patient to yours.',
  },
  RECORD_ACCESS_GRANTED: {
    audience: 'PATIENT', email: true,
    emailSubject: 'A facility was given access to your records',
    label: 'Record access granted',
    description: 'When a new facility is given access to your records. This is a security notice.',
  },
  NEW_NOTE: {
    audience: 'STAFF', roles: ['ADMIN'], emailRoles: ['ADMIN'],
    emailSubject: 'New note on a record',
    label: 'New notes on records',
    description: 'When a colleague leaves a note on a patient record.',
  },
};

// In-app notifications are short-lived by design: they are prompts, not
// records. Older ones are removed the next time their owner opens the list.
export const NOTIFICATION_RETENTION_DAYS = 90;

type Logger = (message: string) => void;
const defaultLog: Logger = (message) => console.warn(message);

function appUrl(path: string) {
  return `${process.env.FRONTEND_URL || 'http://localhost:3000'}${path}`;
}

/**
 * Tell the relevant staff of one facility. Creates the in-app notification for
 * every recipient whose role the rule includes, and emails only those in
 * `emailRoles` who haven't opted out. Never throws: a notification problem
 * must not fail the action that triggered it.
 */
export async function notifyStaff(input: {
  type: NotificationType;
  clinicId: string;
  title: string;
  body: string;
  link: string;
  emailSummary: string;
  excludeUserId?: string;
  log?: Logger;
}): Promise<void> {
  const log = input.log ?? defaultLog;
  try {
    const rule = NOTIFICATION_RULES[input.type];
    if (rule.audience !== 'STAFF') return;

    const recipients = await prisma.user.findMany({
      where: {
        clinicId: input.clinicId,
        isActive: true,
        role: { in: rule.roles },
        ...(input.excludeUserId ? { id: { not: input.excludeUserId } } : {}),
      },
      select: { id: true, email: true, role: true, emailOptOuts: true },
    });
    if (recipients.length === 0) return;

    await prisma.notification.createMany({
      data: recipients.map((recipient) => ({
        userId: recipient.id, clinicId: input.clinicId, type: input.type,
        title: input.title, body: input.body, link: input.link,
      })),
    });

    for (const recipient of recipients) {
      if (!rule.emailRoles.includes(recipient.role) || recipient.emailOptOuts.includes(input.type)) continue;
      void sendMail({
        to: recipient.email,
        subject: rule.emailSubject,
        html: notificationEmail({ heading: rule.emailSubject, message: input.emailSummary, ctaUrl: appUrl(input.link), ctaLabel: 'Open Bulamu' }),
      }).then((result) => {
        if (!result.sent) log(`Notification email to ${recipient.email} not sent: ${result.reason}`);
      });
    }
  } catch (error: any) {
    log(`Staff notification ${input.type} failed: ${error?.message}`);
  }
}

/**
 * Tell a patient through their own portal account. The in-app notification is
 * always created; the email goes out only once the patient has activated the
 * account (proving they control that mailbox) and hasn't opted out. Never
 * throws.
 */
export async function notifyPatient(input: {
  type: NotificationType;
  patientAccountId: string;
  clinicId?: string;
  title: string;
  body: string;
  link: string;
  emailSummary: string;
  log?: Logger;
}): Promise<void> {
  const log = input.log ?? defaultLog;
  try {
    const rule = NOTIFICATION_RULES[input.type];
    if (rule.audience !== 'PATIENT') return;

    const account = await prisma.patientAccount.findUnique({
      where: { id: input.patientAccountId },
      select: { email: true, status: true, mustResetPassword: true, emailOptOuts: true },
    });
    if (!account || account.status !== 'ACTIVE') return;

    await prisma.notification.create({
      data: {
        patientAccountId: input.patientAccountId, clinicId: input.clinicId ?? null, type: input.type,
        title: input.title, body: input.body, link: input.link,
      },
    });

    if (rule.email && !account.mustResetPassword && !account.emailOptOuts.includes(input.type)) {
      void sendMail({
        to: account.email,
        subject: rule.emailSubject,
        html: notificationEmail({ heading: rule.emailSubject, message: input.emailSummary, ctaUrl: appUrl(input.link), ctaLabel: 'Open Patient Portal' }),
      }).then((result) => {
        if (!result.sent) log(`Notification email to ${account.email} not sent: ${result.reason}`);
      });
    }
  } catch (error: any) {
    log(`Patient notification ${input.type} failed: ${error?.message}`);
  }
}

/**
 * A restock alert fires when stock *crosses* down to its reorder level, not
 * on every change while it stays low, so a pharmacist gets one alert per
 * shortage instead of one per dispense. `previousQuantity` is null for a
 * newly added medicine (alert only if it starts out already low).
 */
export async function notifyIfLowStock(
  medicine: { clinicId: string; name: string; quantity: number; unit: string; reorderLevel: number },
  previousQuantity: number | null,
  log?: Logger
): Promise<void> {
  const isLow = medicine.quantity <= medicine.reorderLevel;
  const wasLow = previousQuantity !== null && previousQuantity <= medicine.reorderLevel;
  if (!isLow || wasLow) return;

  await notifyStaff({
    type: 'LOW_STOCK',
    clinicId: medicine.clinicId,
    title: `Restock needed: ${medicine.name}`,
    body: `${medicine.name} is down to ${medicine.quantity} ${medicine.unit} (reorder level ${medicine.reorderLevel}).`,
    link: '/inventory',
    emailSummary: 'One or more medicines have fallen to their reorder level and need restocking. Open the Inventory page to see which.',
    log,
  });
}

// Tells the patient (if they have a portal account) that a result has been
// recorded. The in-app text may name the test - it is only shown after they
// sign in - but the email says only that something is waiting.
export async function notifyLabResultReady(
  input: { patient: { clinicId: string; patientAccountId: string | null }; testName: string },
  log?: Logger
): Promise<void> {
  if (!input.patient.patientAccountId) return;
  const clinic = await prisma.clinic.findUnique({ where: { id: input.patient.clinicId }, select: { name: true } });
  await notifyPatient({
    type: 'LAB_RESULT_READY',
    patientAccountId: input.patient.patientAccountId,
    clinicId: input.patient.clinicId,
    title: 'Your lab results are ready',
    body: `Your ${input.testName} result from ${clinic?.name ?? 'your facility'} has been recorded. Open your records to view it.`,
    link: '/patient-portal/dashboard',
    emailSummary: 'New results are available in your Bulamu Patient Portal. Sign in to view them.',
    log,
  });
}

export async function notifyNewPrescription(
  input: { clinicId: string; patientName: string; itemCount: number },
  log?: Logger
): Promise<void> {
  if (input.itemCount <= 0) return;
  await notifyStaff({
    type: 'NEW_PRESCRIPTION',
    clinicId: input.clinicId,
    title: `New prescription: ${input.patientName}`,
    body: `${input.itemCount} item${input.itemCount === 1 ? '' : 's'} to dispense for ${input.patientName}.`,
    link: '/inventory',
    emailSummary: 'A new prescription is waiting to be dispensed.',
    log,
  });
}

// --- Reading and managing a recipient's own notifications -------------------

export type Recipient = { userId: string } | { patientAccountId: string };

function recipientWhere(recipient: Recipient) {
  return 'userId' in recipient ? { userId: recipient.userId } : { patientAccountId: recipient.patientAccountId };
}

export async function listNotifications(recipient: Recipient, limit = 50) {
  const where = recipientWhere(recipient);
  // Lazy retention: expire this recipient's old notifications whenever they
  // look, so no separate clean-up job is needed.
  await prisma.notification.deleteMany({
    where: { ...where, createdAt: { lt: new Date(Date.now() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000) } },
  });
  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      select: { id: true, type: true, title: true, body: true, link: true, readAt: true, createdAt: true },
    }),
    prisma.notification.count({ where: { ...where, readAt: null } }),
  ]);
  return { notifications, unreadCount };
}

export async function unreadCount(recipient: Recipient) {
  return prisma.notification.count({ where: { ...recipientWhere(recipient), readAt: null } });
}

// Scoped to the recipient in the query itself, so one user can never mark (or
// even detect) another's notification by guessing an ID.
export async function markRead(recipient: Recipient, id: string): Promise<boolean> {
  const result = await prisma.notification.updateMany({
    where: { id, ...recipientWhere(recipient) },
    data: { readAt: new Date() },
  });
  return result.count > 0;
}

export async function markAllRead(recipient: Recipient) {
  await prisma.notification.updateMany({ where: { ...recipientWhere(recipient), readAt: null }, data: { readAt: new Date() } });
}

// The notification types relevant to this recipient, with whether each one
// can be emailed to them and whether they have email switched on.
export function describePreferences(
  audience: { role: Role } | { patient: true },
  emailOptOuts: NotificationType[]
) {
  return (Object.keys(NOTIFICATION_RULES) as NotificationType[])
    .filter((type) => {
      const rule = NOTIFICATION_RULES[type];
      return 'role' in audience
        ? rule.audience === 'STAFF' && rule.roles.includes(audience.role)
        : rule.audience === 'PATIENT';
    })
    .map((type) => {
      const rule = NOTIFICATION_RULES[type];
      const emailAvailable = rule.audience === 'STAFF'
        ? 'role' in audience && rule.emailRoles.includes(audience.role)
        : rule.email;
      return {
        type,
        label: rule.label,
        description: rule.description,
        emailAvailable,
        emailEnabled: emailAvailable && !emailOptOuts.includes(type),
      };
    });
}

// Only types the recipient could actually be emailed about can be opted out of.
export function sanitizeOptOuts(
  audience: { role: Role } | { patient: true },
  requested: unknown
): NotificationType[] {
  if (!Array.isArray(requested)) return [];
  const allowed = new Set(describePreferences(audience, []).filter((p) => p.emailAvailable).map((p) => p.type));
  return [...new Set(requested)].filter((type): type is NotificationType => allowed.has(type as NotificationType));
}
