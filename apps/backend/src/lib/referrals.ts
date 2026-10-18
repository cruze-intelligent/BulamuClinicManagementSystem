import { ReferralStatus, ReferralUrgency } from '@prisma/client';
import { prisma } from './prisma';
import { recordAudit } from './audit';
import { referralPeers } from './facility';
import { notifyPatient, notifyStaff } from './notifications';
import { HttpError } from './http-error';

export { HttpError as ReferralError };

/**
 * Referring a patient out to another facility - from the Referrals page, or as
 * the outcome of an inpatient discharge. One path for both, so every referral
 * gets the same checks, consent record, audit entry and notifications.
 */

export const URGENCIES: ReferralUrgency[] = ['ROUTINE', 'URGENT', 'EMERGENCY'];
const URGENCY_LABEL: Record<ReferralUrgency, string> = { ROUTINE: 'Routine', URGENT: 'Urgent', EMERGENCY: 'EMERGENCY' };

type Actor = { userId: string; role: string; clinicId: string };
type Log = (message: string) => void;


const clean = (value: unknown, max: number) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);

export async function createReferral(
  input: {
    patientId: string;
    toClinicId: string;
    reason: unknown;
    urgency?: unknown;
    clinicalSummary?: unknown;
    consentConfirmed: unknown;
  },
  actor: Actor,
  log: Log
) {
  const reason = clean(input.reason, 500);
  if (!reason) throw new HttpError(400, 'Give the reason for the referral');
  const urgency = (URGENCIES as unknown[]).includes(input.urgency) ? (input.urgency as ReferralUrgency) : 'ROUTINE';
  const clinicalSummary = clean(input.clinicalSummary, 4000);
  // The patient's agreement is recorded by the referring clinician; without it
  // nothing about the patient is sent to another facility.
  if (input.consentConfirmed !== true) {
    throw new HttpError(400, 'Confirm that the patient agreed to the referral and to their details being shared with the receiving facility');
  }

  const patient = await prisma.patient.findUnique({ where: { id: input.patientId } });
  if (!patient || patient.deletedAt) throw new HttpError(404, 'Patient not found');
  if (patient.clinicId !== actor.clinicId) throw new HttpError(403, 'Access denied: you do not have access to this patient');

  if (input.toClinicId === patient.clinicId) throw new HttpError(400, 'Choose a different facility - a patient cannot be referred to the facility they are already at');
  const toClinic = await prisma.clinic.findFirst({
    where: { AND: [await referralPeers(patient.clinicId), { id: input.toClinicId, registrationStatus: 'APPROVED' }] },
    select: { id: true, name: true },
  });
  if (!toClinic) throw new HttpError(404, 'Destination facility not found');

  const referral = await prisma.referral.create({
    data: {
      patientId: patient.id,
      fromClinicId: patient.clinicId,
      toClinicId: toClinic.id,
      reason,
      urgency,
      clinicalSummary,
      referredByUserId: actor.userId,
      consentRecordedAt: new Date(),
    },
  });

  await recordAudit({
    entity: 'Referral', recordId: referral.id, clinicId: patient.clinicId, action: 'CREATE',
    actorUserId: actor.userId, actorRole: actor.role, metadata: { toClinicId: toClinic.id, urgency, patientId: patient.id },
  });

  const fromClinic = await prisma.clinic.findUnique({ where: { id: patient.clinicId }, select: { name: true } });
  const urgent = urgency !== 'ROUTINE';
  await notifyStaff({
    type: 'REFERRAL_RECEIVED',
    clinicId: toClinic.id,
    title: urgent ? `${URGENCY_LABEL[urgency]} referral received` : 'New referral received',
    body: `${fromClinic?.name ?? 'Another facility'} referred ${patient.name} to your facility${urgent ? ` (${URGENCY_LABEL[urgency].toLowerCase()})` : ''}: ${reason}`,
    link: '/referrals',
    emailSummary: urgent
      ? `Another facility has sent your facility an ${urgency === 'EMERGENCY' ? 'EMERGENCY' : 'urgent'} referral. Open Referrals to review it now.`
      : 'Another facility has referred a patient to yours. Open Referrals to review it.',
    log,
  });

  if (patient.patientAccountId) {
    await notifyPatient({
      type: 'REFERRAL_ISSUED',
      patientAccountId: patient.patientAccountId,
      clinicId: patient.clinicId,
      title: `You have been referred to ${toClinic.name}`,
      body: `${fromClinic?.name ?? 'Your facility'} referred you to ${toClinic.name}. Reason: ${reason}. Take your referral letter with you; you can download it from your records.`,
      link: '/patient-portal/dashboard',
      emailSummary: 'You have been referred to another facility. Sign in to your Patient Portal to see the details and download your referral letter.',
      log,
    });
  }

  return referral;
}

/**
 * Who may move a referral to which status:
 * - the receiving facility accepts or declines a pending referral, and marks
 *   an accepted one completed once the patient has been seen;
 * - the referring facility can cancel it while it is still open.
 */
export function allowedTransition(side: 'sender' | 'receiver', from: ReferralStatus, to: ReferralStatus): boolean {
  if (side === 'receiver') {
    return (from === 'PENDING' && (to === 'ACCEPTED' || to === 'DECLINED')) || (from === 'ACCEPTED' && to === 'COMPLETED');
  }
  return (from === 'PENDING' || from === 'ACCEPTED') && to === 'CANCELLED';
}

export async function updateReferralStatus(id: string, input: { status: unknown; note?: unknown }, actor: Actor, log: Log) {
  const status = input.status as ReferralStatus;
  if (!['ACCEPTED', 'DECLINED', 'COMPLETED', 'CANCELLED'].includes(status)) throw new HttpError(400, 'Invalid status');
  const note = clean(input.note, 1000);

  const existing = await prisma.referral.findUnique({
    where: { id },
    include: { patient: { select: { name: true } }, fromClinic: { select: { name: true } }, toClinic: { select: { name: true } } },
  });
  if (!existing) throw new HttpError(404, 'Referral not found');

  const side = existing.toClinicId === actor.clinicId ? 'receiver' : existing.fromClinicId === actor.clinicId ? 'sender' : null;
  if (!side) throw new HttpError(403, 'Access denied: you do not have access to this referral');
  if (!allowedTransition(side, existing.status, status)) {
    throw new HttpError(409, `A ${existing.status.toLowerCase()} referral cannot be marked ${status.toLowerCase()} by the ${side === 'receiver' ? 'receiving' : 'referring'} facility`);
  }
  if (status === 'DECLINED' && !note) throw new HttpError(400, 'Say why the referral is being declined, so the referring facility can arrange care elsewhere');

  const referral = await prisma.referral.update({
    where: { id },
    data: {
      status,
      ...(side === 'receiver' ? { respondedAt: new Date(), respondedByUserId: actor.userId, ...(note ? { responseNote: note } : {}) } : {}),
    },
  });

  await recordAudit({
    entity: 'Referral', recordId: id, clinicId: actor.clinicId, action: 'UPDATE',
    actorUserId: actor.userId, actorRole: actor.role, metadata: { status, ...(note ? { note } : {}) },
  });

  const verb = { ACCEPTED: 'accepted', DECLINED: 'declined', COMPLETED: 'completed', CANCELLED: 'cancelled' }[status as 'ACCEPTED'];
  if (side === 'receiver') {
    // The clinician who made the referral, and the referring facility's admins.
    const admins = await prisma.user.findMany({ where: { clinicId: existing.fromClinicId, role: 'ADMIN', isActive: true }, select: { id: true } });
    await notifyStaff({
      type: 'REFERRAL_UPDATED',
      clinicId: existing.fromClinicId,
      title: `Referral ${verb}: ${existing.patient.name}`,
      body: `${existing.toClinic.name} ${verb} the referral of ${existing.patient.name}${note ? `: ${note}` : '.'}`,
      link: '/referrals',
      emailSummary: `A facility you referred a patient to has ${verb} the referral. Open Referrals in Bulamu for the details.`,
      userIds: [existing.referredByUserId, ...admins.map((a) => a.id)],
      log,
    });
  } else {
    await notifyStaff({
      type: 'REFERRAL_RECEIVED',
      clinicId: existing.toClinicId,
      title: `Referral cancelled: ${existing.patient.name}`,
      body: `${existing.fromClinic.name} cancelled its referral of ${existing.patient.name}.`,
      link: '/referrals',
      emailSummary: 'A facility has cancelled a referral it sent to yours.',
      log,
    });
  }

  return referral;
}

/**
 * The receiving facility registers the referred patient as its own patient,
 * from the details in the referral (identity, contact, next of kin, and the
 * allergy record - which must travel with the patient). Their clinical history
 * does not come with it: that needs the patient's own approval.
 */
export async function registerReferredPatient(id: string, actor: Actor) {
  const referral = await prisma.referral.findUnique({ where: { id }, include: { patient: true } });
  if (!referral) throw new HttpError(404, 'Referral not found');
  if (referral.toClinicId !== actor.clinicId) throw new HttpError(403, 'Only the receiving facility can register this patient');
  if (referral.status === 'DECLINED' || referral.status === 'CANCELLED') throw new HttpError(409, `This referral was ${referral.status.toLowerCase()}`);

  if (referral.receivingPatientId) {
    const already = await prisma.patient.findUnique({ where: { id: referral.receivingPatientId } });
    if (already && !already.deletedAt) return { patient: already, created: false };
  }

  const source = referral.patient;
  const patient = await prisma.patient.create({
    data: {
      clinicId: actor.clinicId,
      name: source.name,
      phone: source.phone,
      sex: source.sex,
      dateOfBirth: source.dateOfBirth,
      village: source.village,
      parish: source.parish,
      subCounty: source.subCounty,
      district: source.district,
      nextOfKinName: source.nextOfKinName,
      nextOfKinPhone: source.nextOfKinPhone,
      allergyStatus: source.allergyStatus,
      allergies: source.allergies ?? undefined,
      allergiesUpdatedAt: source.allergiesUpdatedAt,
      consentGivenAt: referral.consentRecordedAt,
      consentGivenBy: referral.referredByUserId,
    },
  });
  await prisma.referral.update({ where: { id }, data: { receivingPatientId: patient.id } });

  await recordAudit({
    entity: 'Patient', recordId: patient.id, clinicId: actor.clinicId, action: 'CREATE',
    actorUserId: actor.userId, actorRole: actor.role, metadata: { fromReferralId: id },
  });
  return { patient, created: true };
}
