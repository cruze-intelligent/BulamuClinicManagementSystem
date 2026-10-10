import { FastifyInstance } from 'fastify';
import { AdmissionNoteKind, DischargeOutcome, WardType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getAuthUser } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { recordAudit } from '../lib/audit';
import { notifyPatient, notifyStaff } from '../lib/notifications';
import { createReferral } from '../lib/referrals';
import { HttpError } from '../lib/http-error';
import { ICD10_PATTERN } from '../lib/clinical';
import { normalizeVitals } from '../lib/vitals';
import { generateDischargeSummaryPdf } from '../lib/pdf';
import { allergyText, sexAgeText } from '../lib/patient-text';

/**
 * Inpatients: wards and beds, admission, notes and observations during the
 * stay, transfers between wards, and discharge (home, by referral, or the other
 * HMIS outcomes). Everything is scoped to the caller's own facility.
 */

const WARD_TYPES = Object.values(WardType);
const OUTCOMES = Object.values(DischargeOutcome);
const NOTE_KINDS: AdmissionNoteKind[] = ['NURSING_NOTE', 'WARD_ROUND', 'OBSERVATION'];
const CLINICAL = ['DOCTOR', 'NURSE', 'ADMIN'];

const OUTCOME_LABEL: Record<DischargeOutcome, string> = {
  RECOVERED: 'Discharged - recovered',
  IMPROVED: 'Discharged - improved',
  REFERRED: 'Referred to another facility',
  LEFT_AGAINST_ADVICE: 'Left against medical advice',
  ABSCONDED: 'Absconded',
  DIED: 'Died',
};

const text = (value: unknown, max: number) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);
const icd10 = (value: unknown) => {
  const code = text(value, 10)?.toUpperCase() ?? null;
  return code && ICD10_PATTERN.test(code) ? code : null;
};

const admissionInclude = {
  patient: { select: { id: true, name: true, phone: true, sex: true, dateOfBirth: true, allergyStatus: true, allergies: true, patientAccountId: true } },
  ward: { select: { id: true, name: true, type: true } },
  attendingDoctor: { select: { id: true, name: true } },
  admittedBy: { select: { id: true, name: true } },
  dischargedBy: { select: { id: true, name: true } },
  referral: { select: { id: true, status: true, toClinic: { select: { name: true } } } },
} as const;

export async function admissionRoutes(fastify: FastifyInstance) {
  const log = (message: string) => fastify.log.warn(message);

  // ---- Wards ------------------------------------------------------------------

  fastify.get('/wards', { preHandler: [requireRole(...CLINICAL)] }, async (request) => {
    const { clinicId } = getAuthUser(request);
    const [wards, occupied] = await Promise.all([
      prisma.ward.findMany({ where: { clinicId }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] }),
      prisma.admission.groupBy({ by: ['wardId'], where: { clinicId, status: 'ADMITTED' }, _count: true }),
    ]);
    const count = new Map(occupied.map((o) => [o.wardId, o._count]));
    return { success: true, wards: wards.map((w) => ({ ...w, occupied: count.get(w.id) ?? 0 })) };
  });

  fastify.post('/wards', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const body = request.body as any;
    const name = text(body.name, 80);
    const beds = Number(body.beds);
    if (!name) return reply.status(400).send({ error: 'Give the ward a name' });
    if (!Number.isInteger(beds) || beds < 1 || beds > 500) return reply.status(400).send({ error: 'Beds must be a whole number between 1 and 500' });
    const type = WARD_TYPES.includes(body.type) ? body.type : 'GENERAL';

    const clash = await prisma.ward.findUnique({ where: { clinicId_name: { clinicId: authUser.clinicId, name } } });
    if (clash) return reply.status(409).send({ error: 'A ward with this name already exists' });

    const ward = await prisma.ward.create({ data: { clinicId: authUser.clinicId, name, type, beds } });
    await recordAudit({ entity: 'Ward', recordId: ward.id, clinicId: authUser.clinicId, action: 'CREATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { name, beds } });
    return { success: true, ward: { ...ward, occupied: 0 } };
  });

  fastify.patch('/wards/:id', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as any;
    const body = request.body as any;
    const ward = await prisma.ward.findUnique({ where: { id } });
    if (!ward || ward.clinicId !== authUser.clinicId) return reply.status(404).send({ error: 'Ward not found' });

    const occupied = await prisma.admission.count({ where: { wardId: id, status: 'ADMITTED' } });
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = text(body.name, 80);
      if (!name) return reply.status(400).send({ error: 'Give the ward a name' });
      data.name = name;
    }
    if (body.type !== undefined && WARD_TYPES.includes(body.type)) data.type = body.type;
    if (body.beds !== undefined) {
      const beds = Number(body.beds);
      if (!Number.isInteger(beds) || beds < 1 || beds > 500) return reply.status(400).send({ error: 'Beds must be a whole number between 1 and 500' });
      if (beds < occupied) return reply.status(409).send({ error: `${occupied} patients are on this ward - it cannot have fewer beds than that` });
      data.beds = beds;
    }
    if (body.isActive !== undefined) {
      if (body.isActive === false && occupied > 0) return reply.status(409).send({ error: 'Discharge or transfer the patients on this ward before closing it' });
      data.isActive = Boolean(body.isActive);
    }

    try {
      const updated = await prisma.ward.update({ where: { id }, data });
      await recordAudit({ entity: 'Ward', recordId: id, clinicId: authUser.clinicId, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: data });
      return { success: true, ward: { ...updated, occupied } };
    } catch (error: any) {
      if (error?.code === 'P2002') return reply.status(409).send({ error: 'A ward with this name already exists' });
      throw error;
    }
  });

  // ---- Admissions -------------------------------------------------------------

  fastify.get('/admissions', { preHandler: [requireRole(...CLINICAL)] }, async (request) => {
    const { clinicId } = getAuthUser(request);
    const query = request.query as any;
    const status = query.status === 'DISCHARGED' ? 'DISCHARGED' : query.status === 'ALL' ? undefined : 'ADMITTED';
    const admissions = await prisma.admission.findMany({
      where: { clinicId, ...(status ? { status } : {}), ...(query.wardId ? { wardId: String(query.wardId) } : {}) },
      include: admissionInclude,
      orderBy: status === 'DISCHARGED' ? { dischargedAt: 'desc' } : { admittedAt: 'asc' },
      take: status === 'ADMITTED' ? 500 : 100,
    });
    return { success: true, admissions: admissions.map(present) };
  });

  fastify.get('/patients/:patientId/admissions', { preHandler: [requireRole(...CLINICAL)] }, async (request, reply) => {
    const { clinicId } = getAuthUser(request);
    const { patientId } = request.params as any;
    const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { clinicId: true } });
    if (!patient || patient.clinicId !== clinicId) return reply.status(404).send({ error: 'Patient not found' });
    const admissions = await prisma.admission.findMany({ where: { patientId }, include: admissionInclude, orderBy: { admittedAt: 'desc' } });
    return { success: true, admissions: admissions.map(present) };
  });

  fastify.get('/admissions/:id', { preHandler: [requireRole(...CLINICAL)] }, async (request, reply) => {
    const { clinicId } = getAuthUser(request);
    const { id } = request.params as any;
    const admission = await prisma.admission.findUnique({
      where: { id },
      include: { ...admissionInclude, notes: { orderBy: { createdAt: 'desc' }, include: { author: { select: { name: true } } } } },
    });
    if (!admission || admission.clinicId !== clinicId) return reply.status(404).send({ error: 'Admission not found' });
    return {
      success: true,
      admission: {
        ...present(admission),
        notes: admission.notes.map(({ author, ...n }) => ({ ...n, authorName: author.name })),
      },
    };
  });

  // Admit a patient to a ward bed.
  fastify.post('/admissions', { preHandler: [requireRole(...CLINICAL)] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const body = request.body as any;
    const reason = text(body.reason, 1000);
    const bed = text(body.bed, 20);
    if (!reason) return reply.status(400).send({ error: 'Give the reason for admission (the admitting diagnosis)' });

    const patient = await prisma.patient.findUnique({ where: { id: String(body.patientId ?? '') } });
    if (!patient || patient.deletedAt || patient.clinicId !== authUser.clinicId) return reply.status(404).send({ error: 'Patient not found' });

    const ward = await prisma.ward.findUnique({ where: { id: String(body.wardId ?? '') } });
    if (!ward || ward.clinicId !== authUser.clinicId || !ward.isActive) return reply.status(404).send({ error: 'Ward not found' });

    if (body.attendingDoctorId) {
      const doctor = await prisma.user.findUnique({ where: { id: String(body.attendingDoctorId) }, select: { clinicId: true, isActive: true } });
      if (!doctor || doctor.clinicId !== authUser.clinicId || !doctor.isActive) return reply.status(404).send({ error: 'Attending doctor not found' });
    }

    // One stay at a time, a free bed on the ward, and a bed label used once.
    const admission = await prisma.$transaction(async (tx) => {
      const current = await tx.admission.findFirst({ where: { patientId: patient.id, status: 'ADMITTED' }, include: { ward: { select: { name: true } } } });
      if (current) throw new HttpError(409, `${patient.name} is already admitted (${current.ward.name}). Transfer or discharge that stay instead.`);
      const occupied = await tx.admission.count({ where: { wardId: ward.id, status: 'ADMITTED' } });
      if (occupied >= ward.beds) throw new HttpError(409, `${ward.name} is full (${ward.beds} of ${ward.beds} beds occupied)`);
      if (bed && (await tx.admission.findFirst({ where: { wardId: ward.id, bed, status: 'ADMITTED' } }))) {
        throw new HttpError(409, `Bed ${bed} on ${ward.name} is already occupied`);
      }
      return tx.admission.create({
        data: {
          clinicId: authUser.clinicId,
          patientId: patient.id,
          wardId: ward.id,
          bed,
          reason,
          admissionIcd10Code: icd10(body.admissionIcd10Code),
          attendingDoctorId: body.attendingDoctorId ? String(body.attendingDoctorId) : null,
          admittedByUserId: authUser.userId,
        },
        include: admissionInclude,
      });
    }).catch((error) => error);
    if (admission instanceof HttpError) return reply.status(admission.status).send({ error: admission.message });
    if (admission instanceof Error) throw admission;

    await recordAudit({ entity: 'Admission', recordId: admission.id, clinicId: authUser.clinicId, action: 'CREATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { patientId: patient.id, wardId: ward.id, bed } });
    await notifyStaff({
      type: 'PATIENT_ADMITTED',
      clinicId: authUser.clinicId,
      title: `Admitted: ${patient.name}`,
      body: `${patient.name} was admitted to ${ward.name}${bed ? `, bed ${bed}` : ''}: ${reason}`,
      link: `/wards/admission?id=${admission.id}`,
      emailSummary: 'A patient has been admitted.',
      alsoUserIds: [admission.attendingDoctorId],
      excludeUserId: authUser.userId,
      log,
    });

    return { success: true, admission: present(admission) };
  });

  // A nursing note, ward-round note or set of observations.
  fastify.post('/admissions/:id/notes', { preHandler: [requireRole(...CLINICAL)] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as any;
    const body = request.body as any;
    const admission = await prisma.admission.findUnique({ where: { id }, select: { clinicId: true, status: true } });
    if (!admission || admission.clinicId !== authUser.clinicId) return reply.status(404).send({ error: 'Admission not found' });
    if (admission.status !== 'ADMITTED') return reply.status(409).send({ error: 'This patient has been discharged - notes can no longer be added' });

    const kind: AdmissionNoteKind = NOTE_KINDS.includes(body.kind) ? body.kind : 'NURSING_NOTE';
    const vitals = normalizeVitals(body.vitals);
    if (!vitals.ok) return reply.status(400).send({ error: vitals.error });
    const note = text(body.note, 4000);
    if (!note && !vitals.value) return reply.status(400).send({ error: 'Write a note or record at least one observation' });

    const created = await prisma.admissionNote.create({
      data: { admissionId: id, authorUserId: authUser.userId, authorRole: authUser.role as any, kind, note, vitals: vitals.value ?? undefined },
      include: { author: { select: { name: true } } },
    });
    const { author, ...rest } = created;
    return { success: true, note: { ...rest, authorName: author.name } };
  });

  // Move the patient to another ward or bed.
  fastify.post('/admissions/:id/transfer', { preHandler: [requireRole(...CLINICAL)] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as any;
    const body = request.body as any;
    const bed = text(body.bed, 20);

    const result = await prisma.$transaction(async (tx) => {
      const admission = await tx.admission.findUnique({ where: { id }, include: { ward: true } });
      if (!admission || admission.clinicId !== authUser.clinicId) throw new HttpError(404, 'Admission not found');
      if (admission.status !== 'ADMITTED') throw new HttpError(409, 'This patient has already been discharged');
      const ward = await tx.ward.findUnique({ where: { id: String(body.wardId ?? '') } });
      if (!ward || ward.clinicId !== authUser.clinicId || !ward.isActive) throw new HttpError(404, 'Ward not found');
      if (ward.id === admission.wardId && (bed ?? null) === (admission.bed ?? null)) throw new HttpError(400, 'The patient is already in that bed');
      if (ward.id !== admission.wardId) {
        const occupied = await tx.admission.count({ where: { wardId: ward.id, status: 'ADMITTED' } });
        if (occupied >= ward.beds) throw new HttpError(409, `${ward.name} is full (${ward.beds} of ${ward.beds} beds occupied)`);
      }
      if (bed && (await tx.admission.findFirst({ where: { wardId: ward.id, bed, status: 'ADMITTED', NOT: { id } } }))) {
        throw new HttpError(409, `Bed ${bed} on ${ward.name} is already occupied`);
      }
      const from = `${admission.ward.name}${admission.bed ? `, bed ${admission.bed}` : ''}`;
      const to = `${ward.name}${bed ? `, bed ${bed}` : ''}`;
      await tx.admissionNote.create({
        data: { admissionId: id, authorUserId: authUser.userId, authorRole: authUser.role as any, kind: 'TRANSFER', note: `Moved from ${from} to ${to}.${text(body.note, 500) ? ` ${text(body.note, 500)}` : ''}` },
      });
      return tx.admission.update({ where: { id }, data: { wardId: ward.id, bed }, include: admissionInclude });
    }).catch((error) => error);
    if (result instanceof HttpError) return reply.status(result.status).send({ error: result.message });
    if (result instanceof Error) throw result;

    await recordAudit({ entity: 'Admission', recordId: id, clinicId: authUser.clinicId, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { transferredTo: result.wardId, bed } });
    return { success: true, admission: present(result) };
  });

  // Discharge: a clinical decision, so doctors (clinical officers) and admins.
  fastify.post('/admissions/:id/discharge', { preHandler: [requireRole('DOCTOR', 'ADMIN')] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as any;
    const body = request.body as any;

    const admission = await prisma.admission.findUnique({ where: { id }, include: { patient: true, ward: true } });
    if (!admission || admission.clinicId !== authUser.clinicId) return reply.status(404).send({ error: 'Admission not found' });
    if (admission.status !== 'ADMITTED') return reply.status(409).send({ error: 'This patient has already been discharged' });

    const outcome = body.outcome as DischargeOutcome;
    if (!OUTCOMES.includes(outcome)) return reply.status(400).send({ error: 'Choose how the stay ended' });
    const dischargeDiagnosis = text(body.dischargeDiagnosis, 1000);
    const dischargeSummary = text(body.dischargeSummary, 6000);
    const followUpInstructions = text(body.followUpInstructions, 3000);
    if (!dischargeDiagnosis) return reply.status(400).send({ error: 'Give the final diagnosis' });
    if (!dischargeSummary && outcome !== 'ABSCONDED') return reply.status(400).send({ error: 'Summarise the stay and the treatment given' });

    // Discharge by referral: the referral (and its letter) travels with the patient.
    let referralId: string | null = null;
    if (outcome === 'REFERRED') {
      const ref = body.referral ?? {};
      try {
        const referral = await createReferral(
          {
            patientId: admission.patientId, toClinicId: String(ref.toClinicId ?? ''), reason: ref.reason ?? dischargeDiagnosis,
            urgency: ref.urgency, clinicalSummary: ref.clinicalSummary ?? dischargeSummary, consentConfirmed: ref.consentConfirmed,
          },
          authUser,
          log
        );
        referralId = referral.id;
      } catch (error: any) {
        if (error instanceof HttpError) return reply.status(error.status).send({ error: error.message });
        throw error;
      }
    }

    const discharged = await prisma.admission.update({
      where: { id },
      data: {
        status: 'DISCHARGED',
        dischargedAt: new Date(),
        dischargedByUserId: authUser.userId,
        outcome,
        dischargeDiagnosis,
        dischargeIcd10Code: icd10(body.dischargeIcd10Code),
        dischargeSummary,
        followUpInstructions,
        referralId,
      },
      include: admissionInclude,
    });

    await recordAudit({ entity: 'Admission', recordId: id, clinicId: authUser.clinicId, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { discharged: true, outcome, referralId } });
    await notifyStaff({
      type: 'PATIENT_DISCHARGED',
      clinicId: authUser.clinicId,
      title: `Discharged: ${admission.patient.name}`,
      body: `${admission.patient.name} left ${admission.ward.name}${admission.bed ? ` (bed ${admission.bed})` : ''} - ${OUTCOME_LABEL[outcome].toLowerCase()}.`,
      link: `/wards/admission?id=${id}`,
      emailSummary: 'A patient has been discharged.',
      excludeUserId: authUser.userId,
      log,
    });
    if (admission.patient.patientAccountId && outcome !== 'DIED') {
      await notifyPatient({
        type: 'DISCHARGE_SUMMARY_READY',
        patientAccountId: admission.patient.patientAccountId,
        clinicId: authUser.clinicId,
        title: 'Your discharge summary is ready',
        body: `Your discharge summary from ${admission.ward.name} is in your records${followUpInstructions ? ', with the follow-up instructions' : ''}.`,
        link: '/patient-portal/dashboard',
        emailSummary: 'Your discharge summary is ready. Sign in to your Patient Portal to read it and your follow-up instructions.',
        log,
      });
    }

    return { success: true, admission: present(discharged) };
  });

  fastify.get('/admissions/:id/discharge-summary', { preHandler: [requireRole(...CLINICAL)] }, async (request, reply) => {
    const { clinicId } = getAuthUser(request);
    const { id } = request.params as any;
    const admission = await prisma.admission.findUnique({ where: { id }, include: { ...admissionInclude, clinic: { select: { name: true, facilityCode: true } } } });
    if (!admission || admission.clinicId !== clinicId) return reply.status(404).send({ error: 'Admission not found' });
    if (admission.status !== 'DISCHARGED') return reply.status(409).send({ error: 'The patient has not been discharged yet' });

    const pdf = await generateDischargeSummaryPdf(dischargeSummaryInput(admission));
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="discharge-summary-${admission.id.slice(0, 8)}.pdf"`)
      .send(pdf);
  });
}

function present(admission: any) {
  const { patient, ...rest } = admission;
  const end = admission.dischargedAt ? new Date(admission.dischargedAt) : new Date();
  return {
    ...rest,
    patient: {
      id: patient.id, name: patient.name, phone: patient.phone,
      sexAge: sexAgeText(patient), allergies: allergyText(patient),
    },
    outcomeLabel: admission.outcome ? OUTCOME_LABEL[admission.outcome as DischargeOutcome] : null,
    daysAdmitted: Math.max(1, Math.ceil((end.getTime() - new Date(admission.admittedAt).getTime()) / 86400000)),
  };
}

export function dischargeSummaryInput(admission: any) {
  return {
    admissionId: admission.id,
    clinicName: admission.clinic.name,
    facilityCode: admission.clinic.facilityCode,
    patient: { name: admission.patient.name, sexAge: sexAgeText(admission.patient), phone: admission.patient.phone },
    ward: `${admission.ward.name}${admission.bed ? `, bed ${admission.bed}` : ''}`,
    admittedAt: admission.admittedAt,
    dischargedAt: admission.dischargedAt,
    attendingDoctor: admission.attendingDoctor?.name ?? null,
    dischargedBy: admission.dischargedBy?.name ?? null,
    admissionReason: admission.reason,
    outcome: OUTCOME_LABEL[admission.outcome as DischargeOutcome],
    dischargeDiagnosis: [admission.dischargeDiagnosis, admission.dischargeIcd10Code ? `(ICD-10 ${admission.dischargeIcd10Code})` : null].filter(Boolean).join(' '),
    dischargeSummary: admission.dischargeSummary,
    followUpInstructions: admission.followUpInstructions,
    referredTo: admission.referral?.toClinic?.name ?? null,
    allergies: allergyText(admission.patient),
  };
}
