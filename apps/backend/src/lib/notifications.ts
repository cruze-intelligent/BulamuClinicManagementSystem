import { NotificationType, Role } from '@prisma/client';
import { prisma } from './prisma';
import { sendMail, notificationEmail } from './mailer';

/**
 * Who is told about what - the single place to read (and change) which
 * notifications each role receives and which of them also arrive by email.
 *
 * - `roles`: staff roles that get the in-app notification (a facility's own
 *   staff only - never another facility's). For a `personal` rule these are
 *   the roles the notification can reach, but it goes only to the specific
 *   people involved (the clinician who ordered the test, the doctor the
 *   appointment is with, the clinician who made the referral...).
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
  personal?: boolean;
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
  // --- Pharmacy and stock ---------------------------------------------------
  NEW_PRESCRIPTION: {
    audience: 'STAFF', roles: ['PHARMACIST'], emailRoles: [],
    emailSubject: 'New prescription to dispense',
    label: 'New prescriptions',
    description: 'When a consultation includes prescriptions to dispense. In-app only.',
  },
  LOW_STOCK: {
    audience: 'STAFF', roles: ['PHARMACIST', 'ADMIN'], emailRoles: ['PHARMACIST', 'ADMIN'],
    emailSubject: 'Restock needed',
    label: 'Low stock (restock needed)',
    description: 'When a medicine falls to or below its reorder level.',
  },
  OUT_OF_STOCK: {
    audience: 'STAFF', roles: ['PHARMACIST', 'ADMIN'], emailRoles: ['PHARMACIST', 'ADMIN'],
    emailSubject: 'A medicine is out of stock',
    label: 'Out of stock',
    description: 'When a medicine runs out completely.',
  },
  STOCK_EXPIRING: {
    audience: 'STAFF', roles: ['PHARMACIST', 'ADMIN'], emailRoles: ['PHARMACIST', 'ADMIN'],
    emailSubject: 'Stock expiring soon',
    label: 'Expiring or expired stock',
    description: 'When a medicine in stock expires within 60 days, and again once it has expired.',
  },

  // --- Laboratory -------------------------------------------------------------
  LAB_TEST_ORDERED: {
    audience: 'STAFF', roles: ['NURSE'], emailRoles: [],
    emailSubject: 'New lab test ordered',
    label: 'Lab tests ordered',
    description: 'When a clinician orders a lab test for a patient. In-app only.',
  },
  LAB_RESULT_AVAILABLE: {
    audience: 'STAFF', roles: ['DOCTOR', 'NURSE', 'ADMIN'], emailRoles: ['DOCTOR'], personal: true,
    emailSubject: 'A lab result you ordered is ready',
    label: 'Results of tests I ordered',
    description: 'When the result of a lab test you ordered has been recorded.',
  },

  // --- Appointments -----------------------------------------------------------
  APPOINTMENT_REQUESTED: {
    audience: 'STAFF', roles: ['STAFF', 'NURSE', 'ADMIN'], emailRoles: ['STAFF', 'ADMIN'],
    emailSubject: 'New appointment request',
    label: 'Appointment requests',
    description: 'When a patient requests an appointment through the Patient Portal.',
  },
  APPOINTMENT_BOOKED: {
    audience: 'STAFF', roles: ['DOCTOR'], emailRoles: [], personal: true,
    emailSubject: 'New appointment booked with you',
    label: 'Appointments booked with me',
    description: 'When a colleague books a patient into your list. In-app only.',
  },
  APPOINTMENT_CANCELLED: {
    audience: 'STAFF', roles: ['DOCTOR'], emailRoles: [], personal: true,
    emailSubject: 'An appointment with you was cancelled',
    label: 'My appointments cancelled',
    description: 'When an appointment in your list is cancelled. In-app only.',
  },

  // --- Referrals ----------------------------------------------------------------
  REFERRAL_RECEIVED: {
    audience: 'STAFF', roles: ['ADMIN', 'DOCTOR', 'NURSE', 'STAFF'], emailRoles: ['ADMIN', 'DOCTOR'],
    emailSubject: 'New referral received',
    label: 'Referrals received',
    description: 'When another facility refers a patient to yours, or cancels a referral it sent.',
  },
  REFERRAL_UPDATED: {
    audience: 'STAFF', roles: ['ADMIN', 'DOCTOR', 'NURSE'], emailRoles: ['ADMIN', 'DOCTOR', 'NURSE'], personal: true,
    emailSubject: 'Update on a referral you sent',
    label: 'Replies to referrals we sent',
    description: 'When the receiving facility accepts, declines or completes a referral (to the clinician who made it, and the facility admin).',
  },

  // --- Inpatients ---------------------------------------------------------------
  PATIENT_ADMITTED: {
    audience: 'STAFF', roles: ['NURSE', 'DOCTOR'], emailRoles: [],
    emailSubject: 'Patient admitted',
    label: 'Admissions',
    description: 'When a patient is admitted (nurses, and the attending doctor). In-app only.',
  },
  PATIENT_DISCHARGED: {
    audience: 'STAFF', roles: ['NURSE', 'ADMIN'], emailRoles: [],
    emailSubject: 'Patient discharged',
    label: 'Discharges',
    description: 'When a patient is discharged - a bed is free and the stay can be billed. In-app only.',
  },

  // --- Records and access ---------------------------------------------------------
  NEW_NOTE: {
    audience: 'STAFF', roles: ['ADMIN', 'DOCTOR', 'NURSE'], emailRoles: ['ADMIN'],
    emailSubject: 'New note on a record',
    label: 'New notes on records',
    description: 'When a colleague leaves a note on a patient record.',
  },
  HISTORY_ACCESS_APPROVED: {
    audience: 'STAFF', roles: ['DOCTOR', 'NURSE', 'ADMIN'], emailRoles: [], personal: true,
    emailSubject: 'A patient approved sharing their history',
    label: 'Patients approving history I requested',
    description: 'When a patient approves your request to see their records from other facilities. In-app only.',
  },

  // --- The facility's own account -----------------------------------------------
  SUBSCRIPTION_REMINDER: {
    audience: 'STAFF', roles: ['ADMIN'], emailRoles: ['ADMIN'],
    emailSubject: 'Your Bulamu subscription needs attention',
    label: 'Subscription reminders',
    description: 'Before the free trial or a paid period ends, and when it has ended.',
  },
  PAYMENT_RECEIVED: {
    audience: 'STAFF', roles: ['ADMIN'], emailRoles: [],
    emailSubject: 'Payment received',
    label: 'Payments received',
    description: 'When a subscription payment is confirmed (the receipt is emailed separately). In-app only.',
  },

  // --- Patients (their own portal account) ---------------------------------------
  LAB_RESULT_READY: {
    audience: 'PATIENT', email: true,
    emailSubject: 'Your lab results are ready',
    label: 'Lab results ready',
    description: 'When a lab result for you has been recorded.',
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
  REFERRAL_ISSUED: {
    audience: 'PATIENT', email: true,
    emailSubject: 'You have been referred to another facility',
    label: 'Referrals',
    description: 'When you are referred to another facility. Your referral letter is in the Patient Portal.',
  },
  DISCHARGE_SUMMARY_READY: {
    audience: 'PATIENT', email: true,
    emailSubject: 'Your discharge summary is ready',
    label: 'Discharge summaries',
    description: 'When you are discharged after a stay, with your discharge summary and follow-up instructions.',
  },
  RECORD_ACCESS_GRANTED: {
    audience: 'PATIENT', email: true,
    emailSubject: 'A facility was given access to your records',
    label: 'Record access granted',
    description: 'When a new facility is given access to your records. This is a security notice.',
  },
  HISTORY_ACCESS_REQUESTED: {
    audience: 'PATIENT', email: true,
    emailSubject: 'A facility is asking to see your health history',
    label: 'Requests to see my history',
    description: 'When a facility asks to see your records from other facilities. Nothing is shared unless you approve.',
  },
  HISTORY_SHARING_APPROVED: {
    audience: 'PATIENT', email: true,
    emailSubject: 'You approved sharing your history with a facility',
    label: 'History sharing approved',
    description: 'When you approve a facility seeing your records from other facilities. This is a security notice.',
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
 * every recipient, and emails only those whose role is in `emailRoles` and who
 * haven't opted out. Never throws: a notification problem must not fail the
 * action that triggered it.
 *
 * Recipients are, by default, every active user of the rule's roles. For a
 * `personal` rule pass `userIds` - only those people are told. `alsoUserIds`
 * adds specific people to a role-based notification (e.g. the attending doctor
 * of an admission, on top of the nurses). Always the facility's own staff only.
 */
export async function notifyStaff(input: {
  type: NotificationType;
  clinicId: string;
  title: string;
  body: string;
  link: string;
  emailSummary: string;
  excludeUserId?: string;
  userIds?: Array<string | null | undefined>;
  alsoUserIds?: Array<string | null | undefined>;
  /** A reminder with this key is created at most once per facility. */
  dedupeKey?: string;
  log?: Logger;
}): Promise<void> {
  const log = input.log ?? defaultLog;
  try {
    const rule = NOTIFICATION_RULES[input.type];
    if (rule.audience !== 'STAFF') return;

    if (input.dedupeKey && (await prisma.notification.findFirst({ where: { clinicId: input.clinicId, dedupeKey: input.dedupeKey }, select: { id: true } }))) {
      return;
    }

    const named = (ids?: Array<string | null | undefined>) => [...new Set((ids ?? []).filter((id): id is string => !!id))];
    const targeted = named(input.userIds);
    const extra = named(input.alsoUserIds);
    if (rule.personal && targeted.length === 0) return;

    const recipients = await prisma.user.findMany({
      where: {
        clinicId: input.clinicId,
        isActive: true,
        ...(rule.personal
          ? { id: { in: targeted } }
          : { OR: [{ role: { in: rule.roles } }, ...(extra.length ? [{ id: { in: extra } }] : [])] }),
        ...(input.excludeUserId ? { NOT: { id: input.excludeUserId } } : {}),
      },
      select: { id: true, email: true, role: true, emailOptOuts: true },
    });
    if (recipients.length === 0) return;

    await prisma.notification.createMany({
      data: recipients.map((recipient) => ({
        userId: recipient.id, clinicId: input.clinicId, type: input.type,
        title: input.title, body: input.body, link: input.link, dedupeKey: input.dedupeKey ?? null,
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
 * Stock alerts fire when stock *crosses* a line, not on every change while it
 * stays below it, so a pharmacist gets one alert per shortage instead of one
 * per dispense: once when it falls to the reorder level, and again if it runs
 * out completely. `previousQuantity` is null for a newly added medicine.
 */
export async function notifyIfLowStock(
  medicine: { clinicId: string; name: string; quantity: number; unit: string; reorderLevel: number },
  previousQuantity: number | null,
  log?: Logger
): Promise<void> {
  const isOut = medicine.quantity <= 0;
  const wasOut = previousQuantity !== null && previousQuantity <= 0;
  if (isOut && !wasOut) {
    await notifyStaff({
      type: 'OUT_OF_STOCK',
      clinicId: medicine.clinicId,
      title: `Out of stock: ${medicine.name}`,
      body: `${medicine.name} has run out. Prescriptions for it cannot be dispensed until it is restocked.`,
      link: '/inventory',
      emailSummary: 'A medicine has run out completely and needs restocking. Open the Inventory page to see which.',
      log,
    });
    return;
  }

  const isLow = medicine.quantity <= medicine.reorderLevel;
  const wasLow = previousQuantity !== null && previousQuantity <= medicine.reorderLevel;
  if (!isLow || wasLow || isOut) return;

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

/** A new lab order goes to the nurses who run the lab workflow (not to whoever ordered it). */
export async function notifyLabOrdered(
  input: { clinicId: string; patientName: string; testName: string; orderedByUserId: string },
  log?: Logger
): Promise<void> {
  await notifyStaff({
    type: 'LAB_TEST_ORDERED',
    clinicId: input.clinicId,
    title: `Lab test ordered: ${input.testName}`,
    body: `${input.testName} was ordered for ${input.patientName}.`,
    link: '/lab',
    emailSummary: 'A new lab test has been ordered.',
    excludeUserId: input.orderedByUserId,
    log,
  });
}

/** A completed result goes back to the clinician who ordered it - unless they recorded it themselves. */
export async function notifyLabResultToOrderer(
  input: { clinicId: string; patientName: string; testName: string; orderedByUserId: string | null; recordedByUserId: string },
  log?: Logger
): Promise<void> {
  await notifyStaff({
    type: 'LAB_RESULT_AVAILABLE',
    clinicId: input.clinicId,
    title: `Result ready: ${input.testName}`,
    body: `The ${input.testName} result for ${input.patientName} has been recorded.`,
    link: '/lab',
    emailSummary: 'The result of a lab test you ordered has been recorded. Sign in to Bulamu to see it.',
    userIds: [input.orderedByUserId],
    excludeUserId: input.recordedByUserId,
    log,
  });
}

/** Tells a doctor when a colleague books a patient into their list, or cancels one. */
export async function notifyDoctorOfAppointment(
  input: { clinicId: string; doctorId: string | null; actorUserId: string; patientName: string; date: Date; time: string; cancelled?: boolean },
  log?: Logger
): Promise<void> {
  const when = `${input.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Kampala' })} at ${input.time}`;
  await notifyStaff({
    type: input.cancelled ? 'APPOINTMENT_CANCELLED' : 'APPOINTMENT_BOOKED',
    clinicId: input.clinicId,
    title: input.cancelled ? `Appointment cancelled: ${input.patientName}` : `New appointment: ${input.patientName}`,
    body: input.cancelled
      ? `The appointment with ${input.patientName} on ${when} was cancelled.`
      : `${input.patientName} has been booked to see you on ${when}.`,
    link: '/appointments',
    emailSummary: input.cancelled ? 'An appointment in your list was cancelled.' : 'A patient has been booked to see you.',
    userIds: [input.doctorId],
    excludeUserId: input.actorUserId,
    log,
  });
}

// --- Periodic reminders --------------------------------------------------------
// Expiring stock and subscription deadlines depend on the date, not on any one
// action, and there is no background scheduler on the hosting plan. So they are
// checked when a facility's staff use the app - at most every few hours per
// facility - and each reminder carries a dedupeKey so it is raised only once.

const EXPIRY_WARNING_DAYS = 60;
const SUBSCRIPTION_WARNING_DAYS = 3;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const lastChecked = new Map<string, number>();
// Off in the test suite (a background write could land between one test's
// reset and the next); tests of the checks call runPeriodicChecks directly.
let periodicChecksEnabled = process.env.NODE_ENV !== 'test';

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const shortDate = (date: Date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Kampala' });

/** Runs the date-based checks for one facility, unless they ran recently. Never throws. */
export function runPeriodicChecksSoon(clinicId: string, log?: Logger): void {
  if (!periodicChecksEnabled) return;
  const now = Date.now();
  if (now - (lastChecked.get(clinicId) ?? 0) < CHECK_INTERVAL_MS) return;
  lastChecked.set(clinicId, now);
  void runPeriodicChecks(clinicId, new Date(now), log).catch(() => lastChecked.delete(clinicId));
}

export async function runPeriodicChecks(clinicId: string, now: Date = new Date(), log?: Logger): Promise<void> {
  await checkExpiringStock(clinicId, now, log);
  await checkSubscription(clinicId, now, log);
}

async function checkExpiringStock(clinicId: string, now: Date, log?: Logger) {
  const medicines = await prisma.medicine.findMany({
    where: { clinicId, deletedAt: null, quantity: { gt: 0 }, expiryDate: { not: null, lte: new Date(now.getTime() + EXPIRY_WARNING_DAYS * DAY_MS) } },
    select: { id: true, name: true, quantity: true, unit: true, expiryDate: true },
  });
  for (const medicine of medicines) {
    const expiry = medicine.expiryDate!;
    const expired = expiry.getTime() <= now.getTime();
    await notifyStaff({
      type: 'STOCK_EXPIRING',
      clinicId,
      title: expired ? `Expired stock: ${medicine.name}` : `Expiring soon: ${medicine.name}`,
      body: expired
        ? `${medicine.quantity} ${medicine.unit} of ${medicine.name} expired on ${shortDate(expiry)}. Remove it from stock so it is not dispensed.`
        : `${medicine.quantity} ${medicine.unit} of ${medicine.name} expire on ${shortDate(expiry)}.`,
      link: '/inventory',
      emailSummary: expired
        ? 'Some medicines in stock have expired and should be removed so they are not dispensed. Open the Inventory page to see which.'
        : 'Some medicines in stock expire within the next two months. Open the Inventory page to see which.',
      // Once when it comes within 60 days, once more when it has expired.
      dedupeKey: `stock-${expired ? 'expired' : 'expiring'}:${medicine.id}:${isoDay(expiry)}`,
      log,
    });
  }
}

async function checkSubscription(clinicId: string, now: Date, log?: Logger) {
  const subscription = await prisma.subscription.findUnique({ where: { clinicId } });
  if (!subscription || subscription.status === 'CANCELLED') return;

  const deadline = subscription.status === 'TRIALING' ? subscription.trialEndsAt : subscription.currentPeriodEnd;
  if (!deadline) return;
  const daysLeft = (deadline.getTime() - now.getTime()) / DAY_MS;
  if (daysLeft > SUBSCRIPTION_WARNING_DAYS) return;

  const ended = daysLeft <= 0;
  const what = subscription.status === 'TRIALING' ? 'free trial' : 'subscription';
  await notifyStaff({
    type: 'SUBSCRIPTION_REMINDER',
    clinicId,
    title: ended ? `Your ${what} has ended` : `Your ${what} ends on ${shortDate(deadline)}`,
    body: ended
      ? `Your Bulamu ${what} ended on ${shortDate(deadline)}. Subscribe from the Billing page to keep recording new patients and visits.`
      : `Your Bulamu ${what} ends on ${shortDate(deadline)}. Subscribe from the Billing page so your facility's work is not interrupted.`,
    link: '/billing',
    emailSummary: ended
      ? `Your facility's Bulamu ${what} has ended. Sign in and open the Billing page to subscribe.`
      : `Your facility's Bulamu ${what} ends on ${shortDate(deadline)}. Sign in and open the Billing page to subscribe.`,
    dedupeKey: `subscription-${ended ? 'ended' : 'ending'}:${subscription.id}:${isoDay(deadline)}`,
    log,
  });
}

/** For tests. */
export function setPeriodicChecksEnabled(value: boolean) {
  periodicChecksEnabled = value;
  lastChecked.clear();
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
    link: '/dispensing',
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
