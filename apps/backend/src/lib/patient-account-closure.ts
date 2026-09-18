import bcrypt from 'bcrypt';
import { prisma } from './prisma';
import { generateToken } from './crypto';
import { deleteFile } from './storage';
import { recordAudit } from './audit';
import { sendMail, patientAccountClosedEmail } from './mailer';

type Logger = (message: string) => void;

/**
 * Closes a patient's portal account, as described in the Data Retention and
 * Deletion Policy (section 4.4) and DATA_RETENTION.md:
 *
 * - erased now: the account's contact details and password, notifications and
 *   preferences, sign-in links and codes, and every document the patient
 *   uploaded themselves;
 * - access ended: every facility grant is revoked and each facility's Patient
 *   row is unlinked from the account (the clinical record itself stays with the
 *   facility, which must keep it);
 * - kept: appointment requests, and the (anonymised) account row, because audit
 *   entries, grants and requests reference it.
 *
 * The database changes commit together; files and the confirmation email follow.
 */
export async function closePatientAccount(patientAccountId: string, log: Logger = console.warn): Promise<void> {
  const account = await prisma.patientAccount.findUniqueOrThrow({
    where: { id: patientAccountId },
    select: { id: true, email: true, createdByClinicId: true },
  });
  const linkedPatients = await prisma.patient.findMany({ where: { patientAccountId }, select: { clinicId: true } });
  const uploadedDocuments = await prisma.document.findMany({
    where: { uploadedByPatientAccountId: patientAccountId },
    select: { storageKey: true },
  });
  const clinicIds = [...new Set([account.createdByClinicId, ...linkedPatients.map((patient) => patient.clinicId)])];

  const unusablePassword = await bcrypt.hash(generateToken(), 10);
  const now = new Date();

  await prisma.$transaction([
    prisma.document.deleteMany({ where: { uploadedByPatientAccountId: patientAccountId } }),
    prisma.patient.updateMany({ where: { patientAccountId }, data: { patientAccountId: null, email: null } }),
    prisma.patientAccessGrant.updateMany({
      where: { patientAccountId, revokedAt: null },
      data: { revokedAt: now, revokedByUserId: patientAccountId },
    }),
    prisma.notification.deleteMany({ where: { patientAccountId } }),
    prisma.patientAccessOtp.deleteMany({ where: { patientAccountId } }),
    prisma.patientPasswordResetToken.deleteMany({ where: { patientAccountId } }),
    prisma.patientAccount.update({
      where: { id: patientAccountId },
      data: {
        status: 'CLOSED',
        // The email column is unique, so it gets a per-account placeholder
        // rather than being blanked.
        email: `closed-${patientAccountId}@closed.invalid`,
        phone: '',
        phoneKey: '',
        password: unusablePassword,
        mustResetPassword: true,
        emailOptOuts: [],
        closedAt: now,
      },
    }),
  ]);

  await Promise.all(uploadedDocuments.map((document) => deleteFile(document.storageKey)));

  for (const clinicId of clinicIds) {
    await recordAudit({
      entity: 'PatientAccount', recordId: patientAccountId, clinicId,
      action: 'DELETE', actorUserId: patientAccountId, actorRole: 'PATIENT',
      metadata: { event: 'ACCOUNT_CLOSED' },
    });
  }

  // Sent to the address the account had, so that a closure the patient did not
  // make is noticed. The address is not stored any longer once this is sent.
  void sendMail({
    to: account.email,
    subject: 'Your Bulamu Patient Portal account has been closed',
    html: patientAccountClosedEmail(),
  }).then((result) => {
    if (!result.sent) log(`Account closure confirmation not sent (${result.reason})`);
  });
}
