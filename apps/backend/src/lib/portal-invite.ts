import bcrypt from 'bcrypt';
import { prisma, isUniqueConstraintError } from './prisma';
import { generateToken, hashToken } from './crypto';
import { generatePortableId, normalizePhoneKey, findAccountByPhone } from './patient-account';
import { sendMail, patientPortalAccountCreatedEmail, patientPasswordResetEmail } from './mailer';
import { recordAudit } from './audit';

// An invitation is sent when a patient is registered - they may not open
// their email for a day or two, so it lives longer than a forgot-password
// link (which the patient asks for and uses straight away).
export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && EMAIL_PATTERN.test(value.trim());
}

function frontendUrl() {
  return process.env.FRONTEND_URL || 'http://localhost:3000';
}

// Issues a fresh set-password link, superseding any earlier unused ones so
// only the newest emailed link works.
export async function issueSetPasswordLink(patientAccountId: string, ttlMs: number): Promise<string> {
  const rawToken = generateToken();
  await prisma.$transaction([
    // Retention: expired and already-used links for this account are removed
    // now that a new one is issued (see DATA_RETENTION.md).
    prisma.patientPasswordResetToken.deleteMany({
      where: { patientAccountId, OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { not: null } }] },
    }),
    prisma.patientPasswordResetToken.updateMany({
      where: { patientAccountId, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.patientPasswordResetToken.create({
      data: { patientAccountId, tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + ttlMs) },
    }),
  ]);
  return `${frontendUrl()}/patient-portal/set-password?token=${rawToken}`;
}

export type PortalAccountOutcome =
  | { status: 'created'; portableId: string; setPasswordUrl: string }
  | { status: 'patient_has_account' }
  | { status: 'phone_in_use'; portableId: string }
  | { status: 'email_in_use' };

type Logger = (message: string) => void;

// Creates a patient's portable portal account and emails them the link to set
// their password. Used both by staff explicitly creating an account and by
// patient registration (when an email is given). Email delivery is
// best-effort and never blocks or fails the caller.
export async function createPortalAccountForPatient(input: {
  patient: { id: string; name: string; clinicId: string; patientAccountId: string | null };
  clinicName: string;
  phone: string;
  email: string;
  actor: { userId: string; role: string };
  log?: Logger;
}): Promise<PortalAccountOutcome> {
  const { patient, clinicName, phone, actor } = input;
  const email = input.email.trim().toLowerCase();
  const log = input.log ?? ((message: string) => console.warn(message));

  if (patient.patientAccountId) return { status: 'patient_has_account' };

  const duplicate = await findAccountByPhone(phone);
  if (duplicate) return { status: 'phone_in_use', portableId: duplicate.portableId };

  try {
    const portableId = await generatePortableId();
    // A random, never-communicated placeholder - the account is unusable
    // until the patient sets their own password via the emailed link.
    const placeholderPassword = await bcrypt.hash(generateToken(), 10);

    const account = await prisma.patientAccount.create({
      data: {
        portableId,
        phone,
        phoneKey: normalizePhoneKey(phone),
        email,
        password: placeholderPassword,
        mustResetPassword: true,
        createdByClinicId: patient.clinicId,
        createdByUserId: actor.userId,
      },
    });

    await prisma.patient.update({ where: { id: patient.id }, data: { patientAccountId: account.id, email } });

    const setPasswordUrl = await issueSetPasswordLink(account.id, INVITE_TTL_MS);

    await recordAudit({
      entity: 'PatientAccount', recordId: account.id, clinicId: patient.clinicId,
      action: 'CREATE', actorUserId: actor.userId, actorRole: actor.role,
      metadata: { patientId: patient.id, portableId },
    });

    void sendMail({
      to: email,
      subject: 'Your Bulamu patient account',
      html: patientPortalAccountCreatedEmail(patient.name, portableId, clinicName, setPasswordUrl),
    }).then((result) => {
      if (!result.sent) log(`Patient portal invitation to ${email} not sent (${result.reason}): ${setPasswordUrl}`);
    });

    return { status: 'created', portableId, setPasswordUrl };
  } catch (error) {
    if (isUniqueConstraintError(error)) return { status: 'email_in_use' };
    throw error;
  }
}

export type RegistrationInvitation = {
  status: PortalAccountOutcome['status'] | 'invalid_email' | 'failed';
  portableId?: string;
  devSetPasswordUrl?: string;
};

// Called right after a patient is registered. If an email was given, invites
// the patient to the portal. This is a side effect of registration, so it
// must never make registration itself fail: every problem is reported in the
// returned status (or logged) rather than thrown. Returns undefined when no
// email was supplied.
export async function inviteNewPatient(input: {
  patient: { id: string; name: string; clinicId: string; patientAccountId: string | null };
  phone: string;
  email: unknown;
  actor: { userId: string; role: string };
  log?: Logger;
}): Promise<RegistrationInvitation | undefined> {
  const log = input.log ?? ((message: string) => console.warn(message));
  if (input.email === undefined || input.email === null || input.email === '') return undefined;
  if (!isValidEmail(input.email)) return { status: 'invalid_email' };

  try {
    const clinic = await prisma.clinic.findUnique({ where: { id: input.patient.clinicId }, select: { name: true } });
    const outcome = await createPortalAccountForPatient({
      patient: input.patient,
      clinicName: clinic?.name ?? 'your facility',
      phone: input.phone,
      email: input.email,
      actor: input.actor,
      log,
    });
    if (outcome.status === 'created') {
      return {
        status: 'created',
        portableId: outcome.portableId,
        ...(process.env.NODE_ENV !== 'production' ? { devSetPasswordUrl: outcome.setPasswordUrl } : {}),
      };
    }
    return { status: outcome.status, ...(outcome.status === 'phone_in_use' ? { portableId: outcome.portableId } : {}) };
  } catch (error: any) {
    log(`Patient portal invitation failed for patient ${input.patient.id}: ${error?.message}`);
    return { status: 'failed' };
  }
}

// Emails a new set-password link to an existing account - used both by staff
// re-sending an invitation and by the patient's own "forgot password".
export async function sendPasswordLink(input: {
  patientAccountId: string;
  email: string;
  patientName: string;
  clinicName: string;
  portableId: string;
  kind: 'invitation' | 'reset';
  log?: Logger;
}): Promise<{ setPasswordUrl: string }> {
  const log = input.log ?? ((message: string) => console.warn(message));
  const setPasswordUrl = await issueSetPasswordLink(input.patientAccountId, input.kind === 'invitation' ? INVITE_TTL_MS : RESET_TTL_MS);

  void sendMail({
    to: input.email,
    subject: input.kind === 'invitation' ? 'Your Bulamu patient account' : 'Reset your Bulamu password',
    html: input.kind === 'invitation'
      ? patientPortalAccountCreatedEmail(input.patientName, input.portableId, input.clinicName, setPasswordUrl)
      : patientPasswordResetEmail(setPasswordUrl),
  }).then((result) => {
    if (!result.sent) log(`Patient password link to ${input.email} not sent (${result.reason}): ${setPasswordUrl}`);
  });

  return { setPasswordUrl };
}
