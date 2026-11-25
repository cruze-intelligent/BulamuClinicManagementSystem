import { FastifyInstance } from 'fastify';
import { AdmissionNoteKind, DischargeOutcome, Role, WardType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getAuthUser, worksAs } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { recordAudit } from '../lib/audit';
import { notifyPatient, notifyStaff } from '../lib/notifications';
import { createReferral } from '../lib/referrals';
import { HttpError } from '../lib/http-error';
import { ICD10_PATTERN, normalizeDiagnoses } from '../lib/clinical';
import { normalizeVitals } from '../lib/vitals';
import { generateDischargeSummaryPdf } from '../lib/pdf';
import { allergyText, patientIdText, sexAgeText } from '../lib/patient-text';
import { facilityLogo } from '../lib/facility-logo';
import { documentProducer, roleTitle } from '../lib/document-signer';
import { parseStructuredNote, structuredNoteLines, structuredNoteTitle, type StructuredNote } from '../lib/procedure-notes';
import { documentFileName, inlineDisposition } from '../lib/document-name';

/**
 * Inpatients: wards and beds, admission, notes and observations during the
 * stay, transfers between wards, and discharge (home, by referral, or the other
 * HMIS outcomes). Everything is scoped to the caller's own facility.
 */

const WARD_TYPES = Object.values(WardType);
const OUTCOMES = Object.values(DischargeOutcome);
const NOTE_KINDS: AdmissionNoteKind[] = ['NURSING_NOTE', 'WARD_ROUND', 'OBSERVATION', 'PROCEDURE', 'OPERATION_NOTE'];
// An operation note is the surgeon's; procedures are done by nurses and clinicians alike.
const OPERATION_NOTE_ROLES = ['DOCTOR', 'ADMIN'];
const CLINICAL = ['DOCTOR', 'NURSE', 'ADMIN'];
const MEDICATION_STATUSES = ['GIVEN', 'REFUSED', 'WITHHELD', 'NOT_AVAILABLE'] as const;

/** The unit given for a ward: null for none, false when it is not one of the facility's. */
async function unitOf(clinicId: string, value: unknown): Promise<string | null | false> {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return false;
  const unit = await prisma.department.findFirst({ where: { id: value, clinicId }, select: { id: true } });
  return unit ? unit.id : false;
}

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
  patient: { select: { id: true, name: true, phone: true, sex: true, dateOfBirth: true, dateOfBirthEstimated: true, patientNumber: true, allergyStatus: true, allergies: true, patientAccountId: true } },
  ward: { select: { id: true, name: true, type: true } },
  attendingDoctor: { select: { id: true, name: true, role: true } },
  admittedBy: { select: { id: true, name: true } },
  dischargedBy: { select: { id: true, name: true, role: true } },
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

    const departmentId = await unitOf(authUser.clinicId, body.departmentId);
    if (departmentId === false) return reply.status(400).send({ error: 'That unit is not part of this facility' });
    const ward = await prisma.ward.create({ data: { clinicId: authUser.clinicId, name, type, beds, departmentId } });
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
    if (body.departmentId !== undefined) {
      const departmentId = await unitOf(authUser.clinicId, body.departmentId);
      if (departmentId === false) return reply.status(400).send({ error: 'That unit is not part of this facility' });
      data.departmentId = departmentId;
    }
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
      include: {
        ...admissionInclude,
        notes: { orderBy: { createdAt: 'desc' }, include: { author: { select: { name: true } } } },
        medicationOrders: {
          orderBy: { createdAt: 'desc' },
          include: {
            prescribedBy: { select: { name: true } },
            administrations: { orderBy: { administeredAt: 'desc' }, take: 20, include: { givenBy: { select: { name: true } } } },
          },
        },
      },
    });
    if (!admission || admission.clinicId !== clinicId) return reply.status(404).send({ error: 'Admission not found' });
    return {
      success: true,
      admission: {
        ...present(admission),
        notes: admission.notes.map(({ author, ...n }) => ({ ...n, authorName: author.name })),
        medicationOrders: admission.medicationOrders.map(({ prescribedBy, administrations, ...order }) => ({
          ...order,
          prescribedByName: prescribedBy.name,
          administrations: administrations.map(({ givenBy, ...entry }) => ({ ...entry, givenByName: givenBy.name })),
        })),
      },
    };
  });

  // Current inpatient medication chart for nurses. Orders stay separate from
  // pharmacy dispensing and are returned only for the caller's own facility.
  fastify.get('/nursing/medications', { preHandler: [requireRole(...CLINICAL)] }, async (request) => {
    const { clinicId } = getAuthUser(request);
    const orders = await prisma.inpatientMedicationOrder.findMany({
      where: { status: 'ACTIVE', startAt: { lte: new Date() }, admission: { clinicId, status: 'ADMITTED' } },
      orderBy: [{ admission: { ward: { name: 'asc' } } }, { admission: { patient: { name: 'asc' } } }, { createdAt: 'desc' }],
      include: {
        prescribedBy: { select: { name: true } },
        administrations: { orderBy: { administeredAt: 'desc' }, take: 5, include: { givenBy: { select: { name: true } } } },
        admission: { select: {
          id: true, bed: true, ward: { select: { name: true } },
          patient: { select: { id: true, name: true, sex: true, dateOfBirth: true, dateOfBirthEstimated: true, patientNumber: true, allergyStatus: true, allergies: true } },
        } },
      },
    });
    return { success: true, orders: orders.map(({ prescribedBy, administrations, admission, ...order }) => ({
      ...order,
      prescribedByName: prescribedBy.name,
      admission,
      administrations: administrations.map(({ givenBy, ...entry }) => ({ ...entry, givenByName: givenBy.name })),
    })) };
  });

  fastify.post('/admissions/:id/medication-orders', { preHandler: [requireRole('DOCTOR', 'ADMIN')] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const medication = text(body?.medication, 120);
    const strength = text(body?.strength, 80);
    const dose = text(body?.dose, 120);
    const route = text(body?.route, 60);
    const frequency = text(body?.frequency, 100);
    const duration = text(body?.duration, 100);
    const instructions = text(body?.instructions, 500);
    const startAt = body?.startAt ? new Date(body.startAt) : new Date();
    if (!medication || !dose || !frequency) return reply.status(400).send({ error: 'Enter the medicine, dose and frequency' });
    if (Number.isNaN(startAt.getTime())) return reply.status(400).send({ error: 'Enter a valid start date' });
    const admission = await prisma.admission.findUnique({ where: { id }, select: { clinicId: true, status: true, patient: { select: { name: true } } } });
    if (!admission || admission.clinicId !== authUser.clinicId) return reply.status(404).send({ error: 'Admission not found' });
    if (admission.status !== 'ADMITTED') return reply.status(409).send({ error: 'Medication cannot be ordered after discharge' });
    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.inpatientMedicationOrder.create({ data: {
        admissionId: id, prescribedByUserId: authUser.userId, medication, strength, dose, route, frequency, duration, instructions, startAt,
      } });
      await tx.admissionNote.create({ data: {
        admissionId: id, authorUserId: authUser.userId, authorRole: authUser.role as Role, kind: 'WARD_ROUND',
        note: `Medication ordered: ${medication}${strength ? ` ${strength}` : ''}; ${dose}${route ? ` ${route}` : ''}; ${frequency}${duration ? ` for ${duration}` : ''}.${instructions ? ` ${instructions}` : ''}`,
      } });
      return created;
    });
    await recordAudit({ entity: 'InpatientMedicationOrder', recordId: order.id, clinicId: admission.clinicId, action: 'CREATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { admissionId: id } });
    await notifyStaff({
      type: 'NEW_INPATIENT_MEDICATION_ORDER', clinicId: admission.clinicId,
      title: `Ward medication order: ${admission.patient.name}`,
      body: `${medication} ${dose} ${route ?? ''} - ${frequency}.`.replace(/\s+/g, ' ').trim(),
      link: '/nursing', emailSummary: 'A new inpatient medication order is available in the nursing chart.',
      excludeUserId: authUser.userId,
    });
    return { success: true, order };
  });

  fastify.post('/admissions/:id/medication-orders/:orderId/stop', { preHandler: [requireRole('DOCTOR', 'ADMIN')] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id, orderId } = request.params as { id: string; orderId: string };
    const reason = text((request.body as any)?.reason, 500);
    const admission = await prisma.admission.findUnique({ where: { id }, select: { clinicId: true, status: true } });
    if (!admission || admission.clinicId !== authUser.clinicId) return reply.status(404).send({ error: 'Admission not found' });
    if (admission.status !== 'ADMITTED') return reply.status(409).send({ error: 'This patient has been discharged' });
    const updated = await prisma.inpatientMedicationOrder.updateMany({
      where: { id: orderId, admissionId: id, status: 'ACTIVE' },
      data: { status: 'STOPPED', stoppedAt: new Date(), stopReason: reason },
    });
    if (!updated.count) return reply.status(404).send({ error: 'Active medication order not found' });
    await recordAudit({ entity: 'InpatientMedicationOrder', recordId: orderId, clinicId: admission.clinicId, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { event: 'STOPPED' } });
    return { success: true };
  });

  fastify.post('/admissions/:id/medication-orders/:orderId/administrations', { preHandler: [requireRole(...CLINICAL)] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id, orderId } = request.params as { id: string; orderId: string };
    const body = request.body as any;
    const status = body?.status;
    const doseGiven = text(body?.doseGiven, 120);
    const routeGiven = text(body?.routeGiven, 60);
    const note = text(body?.note, 500);
    const administeredAt = body?.administeredAt ? new Date(body.administeredAt) : new Date();
    if (!MEDICATION_STATUSES.includes(status)) return reply.status(400).send({ error: 'Choose whether the dose was given, refused, withheld or unavailable' });
    if (status === 'GIVEN' && !doseGiven) return reply.status(400).send({ error: 'Enter the dose that was given' });
    if (status !== 'GIVEN' && !note) return reply.status(400).send({ error: 'Record why the dose was not given' });
    if (Number.isNaN(administeredAt.getTime()) || administeredAt.getTime() > Date.now() + 60_000) return reply.status(400).send({ error: 'Enter a valid administration time that is not in the future' });
    const order = await prisma.inpatientMedicationOrder.findFirst({ where: { id: orderId, admissionId: id }, include: { admission: { select: { clinicId: true, status: true } } } });
    if (!order || order.admission.clinicId !== authUser.clinicId) return reply.status(404).send({ error: 'Medication order not found' });
    if (order.admission.status !== 'ADMITTED' || order.status !== 'ACTIVE') return reply.status(409).send({ error: 'This medication order is no longer active' });
    if (administeredAt < order.startAt) return reply.status(400).send({ error: 'The administration time is before this order started' });
    const entry = await prisma.medicationAdministration.create({ data: {
      orderId, givenByUserId: authUser.userId, status, doseGiven: status === 'GIVEN' ? doseGiven : null,
      routeGiven: status === 'GIVEN' ? routeGiven : null, administeredAt, note,
    } });
    await recordAudit({ entity: 'MedicationAdministration', recordId: entry.id, clinicId: order.admission.clinicId, action: 'CREATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { admissionId: id, orderId, status } });
    return { success: true, administration: entry };
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

  // A nursing note or intervention, ward-round note, set of observations,
  // procedure or operation note.
  fastify.post('/admissions/:id/notes', { preHandler: [requireRole(...CLINICAL)] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as any;
    const body = request.body as any;
    const admission = await prisma.admission.findUnique({ where: { id }, select: { clinicId: true, status: true } });
    if (!admission || admission.clinicId !== authUser.clinicId) return reply.status(404).send({ error: 'Admission not found' });
    if (admission.status !== 'ADMITTED') return reply.status(409).send({ error: 'This patient has been discharged - notes can no longer be added' });

    const kind: AdmissionNoteKind = NOTE_KINDS.includes(body.kind) ? body.kind : 'NURSING_NOTE';
    let details: StructuredNote | undefined;
    if (kind === 'PROCEDURE' || kind === 'OPERATION_NOTE') {
      if (kind === 'OPERATION_NOTE' && !worksAs(authUser, ...OPERATION_NOTE_ROLES)) {
        return reply.status(403).send({ error: 'Operation notes are written by the operating clinician' });
      }
      const parsed = parseStructuredNote(kind, body.details);
      if ('error' in parsed) return reply.status(400).send({ error: parsed.error });
      details = parsed.details;
    }
    const vitals = details ? { ok: true as const, value: null } : normalizeVitals(body.vitals);
    if (!vitals.ok) return reply.status(400).send({ error: vitals.error });
    const note = text(body.note, 4000);
    if (!note && !vitals.value && !details) return reply.status(400).send({ error: 'Write a note or record at least one observation' });

    const created = await prisma.admissionNote.create({
      data: { admissionId: id, authorUserId: authUser.userId, authorRole: authUser.role as any, kind, note, vitals: vitals.value ?? undefined, details },
      include: { author: { select: { name: true } } },
    });
    const { author, ...rest } = created;
    return { success: true, note: { ...rest, authorName: author.name } };
  });

  // The working diagnoses, added to or changed on a ward round (doctors and
  // administrators). The list replaces the one before, and the change is
  // written in the chart as a ward round entry - who changed it, and when.
  fastify.put('/admissions/:id/diagnoses', { preHandler: [requireRole('DOCTOR', 'ADMIN')] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as any;
    const admission = await prisma.admission.findUnique({ where: { id }, select: { clinicId: true, status: true } });
    if (!admission || admission.clinicId !== authUser.clinicId) return reply.status(404).send({ error: 'Admission not found' });
    if (admission.status !== 'ADMITTED') return reply.status(409).send({ error: 'This patient has been discharged - the final diagnosis is on the discharge summary' });
    const valid = normalizeDiagnoses((request.body as any)?.diagnoses);
    if (!valid.ok) return reply.status(400).send({ error: valid.error });
    const diagnoses = valid.value;
    const line = (d: (typeof diagnoses)[number]) => `${d.description}${d.icd10Code ? ` (${d.icd10Code})` : ''}${d.certainty === 'PROVISIONAL' ? ' - suspected' : ''}`;
    const primary = diagnoses.filter((d) => d.type === 'PRIMARY');
    const others = diagnoses.filter((d) => d.type !== 'PRIMARY');
    const note = ['Diagnosis updated.', primary.length ? `Primary: ${primary.map(line).join('; ')}.` : '', others.length ? `Also: ${others.map(line).join('; ')}.` : '']
      .filter(Boolean).join(' ');

    const [updated] = await prisma.$transaction([
      prisma.admission.update({ where: { id }, data: { diagnoses: diagnoses as any }, include: admissionInclude }),
      prisma.admissionNote.create({ data: { admissionId: id, authorUserId: authUser.userId, authorRole: authUser.role as any, kind: 'WARD_ROUND', note } }),
    ]);
    await recordAudit({ entity: 'Admission', recordId: id, clinicId: admission.clinicId, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { diagnoses: diagnoses.length } });
    return { success: true, admission: present(updated) };
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

    const dischargedAt = new Date();
    const discharged = await prisma.$transaction(async (tx) => {
      const result = await tx.admission.update({
        where: { id },
        data: {
          status: 'DISCHARGED',
          dischargedAt,
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
      await tx.inpatientMedicationOrder.updateMany({
        where: { admissionId: id, status: 'ACTIVE' },
        data: { status: 'STOPPED', stoppedAt: dischargedAt, stopReason: 'Patient discharged' },
      });
      return result;
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
    const admission = await prisma.admission.findUnique({ where: { id }, include: { ...admissionInclude, clinic: { select: { name: true, facilityCode: true, phone: true, motto: true } }, notes: { select: { kind: true, details: true, createdAt: true } } } });
    if (!admission || admission.clinicId !== clinicId) return reply.status(404).send({ error: 'Admission not found' });
    if (admission.status !== 'DISCHARGED') return reply.status(409).send({ error: 'The patient has not been discharged yet' });

    const pdf = await generateDischargeSummaryPdf({ ...dischargeSummaryInput(admission), clinicLogo: await facilityLogo(admission.clinicId), producedBy: await documentProducer(getAuthUser(request).userId) });
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', inlineDisposition(documentFileName('Discharge summary', admission.patient.name, admission.dischargedAt)))
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

/** The procedures and operations recorded on the chart, oldest first, as the discharge summary prints them. */
function proceduresDuringStay(notes: Array<{ kind: string; details: unknown; createdAt: Date }> | undefined): string | null {
  const done = (notes ?? [])
    .filter((n) => n.kind === 'PROCEDURE' || n.kind === 'OPERATION_NOTE')
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  if (done.length === 0) return null;
  return done
    .map((n) => [
      `${structuredNoteTitle(n.kind, n.details)} - ${new Date(n.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Kampala' })}`,
      ...structuredNoteLines(n.kind, n.details).filter(([label]) => !['Operation', 'Procedure', 'Surgeon', 'Anaesthesia'].includes(label) || n.kind === 'OPERATION_NOTE' && label === 'Procedure').map(([label, value]) => `${label}: ${value}`),
    ].join('\n'))
    .join('\n');
}

export function dischargeSummaryInput(admission: any) {
  return {
    admissionId: admission.id,
    clinicName: admission.clinic.name,
    facilityCode: admission.clinic.facilityCode,
    clinicPhone: admission.clinic.phone ?? null,
    clinicMotto: admission.clinic.motto ?? null,
    patient: { name: admission.patient.name, number: patientIdText(admission.patient.patientNumber), sexAge: sexAgeText(admission.patient), phone: admission.patient.phone },
    ward: `${admission.ward.name}${admission.bed ? `, bed ${admission.bed}` : ''}`,
    admittedAt: admission.admittedAt,
    dischargedAt: admission.dischargedAt,
    attendingDoctor: admission.attendingDoctor?.name ?? null,
    dischargedBy: admission.dischargedBy?.name ?? null,
    dischargedByRole: admission.dischargedBy?.role ? roleTitle(admission.dischargedBy.role) : null,
    admissionReason: admission.reason,
    outcome: OUTCOME_LABEL[admission.outcome as DischargeOutcome],
    dischargeDiagnosis: [admission.dischargeDiagnosis, admission.dischargeIcd10Code ? `(ICD-10 ${admission.dischargeIcd10Code})` : null].filter(Boolean).join(' '),
    dischargeSummary: admission.dischargeSummary,
    // Procedures and operations during the stay, oldest first, each with its own record.
    procedures: proceduresDuringStay(admission.notes),
    followUpInstructions: admission.followUpInstructions,
    referredTo: admission.referral?.toClinic?.name ?? null,
    allergies: allergyText(admission.patient),
  };
}
