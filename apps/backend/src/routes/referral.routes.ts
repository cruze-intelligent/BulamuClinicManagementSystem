import { FastifyInstance, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';
import { getAuthUser, resolveClinicScope } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { createReferral, ReferralError, registerReferredPatient, updateReferralStatus } from '../lib/referrals';
import { generateReferralLetterPdf } from '../lib/pdf';
import { addressText, allergyText, nextOfKinText, sexAgeText } from '../lib/patient-text';
import { facilityLogo } from '../lib/facility-logo';
import { documentProducer, roleTitle } from '../lib/document-signer';
import { sendRouteError } from '../lib/http-error';

function fail(reply: FastifyReply, error: any) {
  if (error instanceof ReferralError) return reply.status(error.status).send({ error: error.message });
  return sendRouteError(reply, error, 400);
}

export async function referralRoutes(fastify: FastifyInstance) {
  const log = (message: string) => fastify.log.warn(message);

  // Refer a patient out to another facility (e.g. HC II -> HC III for a complicated case).
  fastify.post('/referrals', { preHandler: [requireRole('NURSE', 'DOCTOR', 'ADMIN')] }, async (request, reply) => {
    const body = request.body as any;
    const authUser = getAuthUser(request);
    try {
      const referral = await createReferral(
        {
          patientId: body.patientId, toClinicId: body.toClinicId, reason: body.reason,
          urgency: body.urgency, clinicalSummary: body.clinicalSummary, consentConfirmed: body.consentConfirmed,
        },
        authUser,
        log
      );
      return { success: true, referral };
    } catch (error: any) {
      return fail(reply, error);
    }
  });

  // Referrals a facility has sent and received. Front desk staff see the
  // arrivals they need to register, but not the clinical summary.
  fastify.get('/referrals/:clinicId', { preHandler: [requireRole('NURSE', 'DOCTOR', 'ADMIN', 'STAFF')] }, async (request, reply) => {
    const { clinicId: requestedClinicId } = request.params as any;
    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;
    const clinical = getAuthUser(request).role !== 'STAFF';

    try {
      const referrals = await prisma.referral.findMany({
        where: { OR: [{ fromClinicId: clinicId }, { toClinicId: clinicId }] },
        include: {
          patient: {
            select: {
              name: true, phone: true, sex: true, dateOfBirth: true, village: true, parish: true, subCounty: true, district: true,
              nextOfKinName: true, nextOfKinPhone: true, allergyStatus: true, allergies: true,
            },
          },
          fromClinic: { select: { name: true, phone: true } },
          toClinic: { select: { name: true, phone: true } },
          referredBy: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return {
        success: true,
        referrals: referrals.map(({ patient, clinicalSummary, ...r }) => ({
          ...r,
          direction: r.toClinicId === clinicId ? 'RECEIVED' : 'SENT',
          clinicalSummary: clinical ? clinicalSummary : null,
          patient: {
            name: patient.name,
            phone: patient.phone,
            sexAge: sexAgeText(patient),
            address: addressText(patient),
            nextOfKin: nextOfKinText(patient),
            allergies: clinical ? allergyText(patient) : null,
          },
          referredBy: r.referredBy?.name ?? null,
        })),
      };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // Accept / decline / complete (receiving facility) or cancel (referring facility).
  fastify.patch('/referrals/:id/status', { preHandler: [requireRole('NURSE', 'DOCTOR', 'ADMIN')] }, async (request, reply) => {
    const { id } = request.params as any;
    const body = request.body as any;
    try {
      const referral = await updateReferralStatus(id, { status: body.status, note: body.note }, getAuthUser(request), log);
      return { success: true, referral };
    } catch (error: any) {
      return fail(reply, error);
    }
  });

  // The receiving facility registers the referred patient as its own.
  fastify.post('/referrals/:id/register-patient', { preHandler: [requireRole('NURSE', 'DOCTOR', 'ADMIN', 'STAFF')] }, async (request, reply) => {
    const { id } = request.params as any;
    try {
      const result = await registerReferredPatient(id, getAuthUser(request));
      return { success: true, ...result };
    } catch (error: any) {
      return fail(reply, error);
    }
  });

  // The referral letter, for either facility to print (the patient carries it).
  fastify.get('/referrals/:id/letter', { preHandler: [requireRole('NURSE', 'DOCTOR', 'ADMIN')] }, async (request, reply) => {
    const { id } = request.params as any;
    const authUser = getAuthUser(request);
    try {
      const referral = await prisma.referral.findUnique({
        where: { id },
        include: { patient: true, fromClinic: true, toClinic: { select: { name: true } }, referredBy: { select: { name: true, role: true } } },
      });
      if (!referral) return reply.status(404).send({ error: 'Referral not found' });
      if (referral.fromClinicId !== authUser.clinicId && referral.toClinicId !== authUser.clinicId) {
        return reply.status(403).send({ error: 'Access denied: you do not have access to this referral' });
      }

      const pdf = await generateReferralLetterPdf({ ...referralLetterInput(referral), fromClinicLogo: await facilityLogo(referral.fromClinicId), producedBy: await documentProducer(authUser.userId) });
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="referral-${referral.id.slice(0, 8)}.pdf"`)
        .send(pdf);
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });
}

export function referralLetterInput(referral: any) {
  return {
    referralId: referral.id,
    fromClinicName: referral.fromClinic.name,
    fromClinicPhone: referral.fromClinic.phone,
    fromFacilityCode: referral.fromClinic.facilityCode,
    toClinicName: referral.toClinic.name,
    urgency: referral.urgency,
    createdAt: referral.createdAt,
    referredByName: referral.referredBy?.name ?? null,
    referredByRole: referral.referredBy?.role ? roleTitle(referral.referredBy.role) : null,
    patient: {
      name: referral.patient.name,
      sexAge: sexAgeText(referral.patient),
      phone: referral.patient.phone,
      address: addressText(referral.patient),
      nextOfKin: nextOfKinText(referral.patient),
    },
    allergies: allergyText(referral.patient),
    reason: referral.reason,
    clinicalSummary: referral.clinicalSummary,
    status: referral.status,
    responseNote: referral.responseNote,
  };
}
