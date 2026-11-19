import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate, getAuthUser, resolveClinicScope, worksAs } from '../middleware/auth.middleware';
import { recordConflictIfStale } from '../lib/conflict';
import { recordAudit } from '../lib/audit';
import { inviteNewPatient, isValidEmail } from '../lib/portal-invite';
import { STOCK_ROLES, createStockItem, discontinueStockItem, parseCount, parseExpiry, parseItemDetails } from '../lib/stock';
import { notifyDoctorOfAppointment, notifyIfLowStock, notifyImagingRequested, notifyLabOrdered, notifyNewPrescription } from '../lib/notifications';
import { normalizeAllergies, normalizeDiagnoses, normalizePrescriptions, primaryDiagnosisText } from '../lib/clinical';
import { consultationChildren, linkStockItems } from '../lib/consultation-records';
import { parseFee } from '../lib/invoices';
import { sendRouteError } from '../lib/http-error';
import { parseConsultationNotes } from '../lib/consultation-notes';
import { sortDepartments } from '../lib/departments';
import { imagingUnitFor, parseImagingRequest, REQUEST_ROLES } from '../lib/imaging';

/**
 * A time a device recorded (when a record was made, when a patient arrived).
 * Devices correct their clocks against the server's (see the app's
 * lib/time.ts), but a time that is unreadable or still in the future - a clock
 * set wrong - is replaced by the server's own time, so no record is stamped
 * with a moment that has not happened yet.
 */
function deviceTime(value: unknown, now: Date = new Date()): Date {
  const time = typeof value === 'string' || value instanceof Date ? new Date(value) : null;
  if (!time || Number.isNaN(time.getTime()) || time.getTime() > now.getTime() + 2 * 60 * 1000) return now;
  return time;
}

const DEPENDENCY_WAIT_MS = 7 * 24 * 60 * 60 * 1000;

/** What to tell staff about a change the server refused, from the logged reason. */
export function syncRejectionReason(logged: string): string {
  const why = logged.replace(/^Rejected [^:]*: /, '');
  if (/does not match caller|another clinic|out of scope|belongs to another/i.test(why)) return 'It belongs to another facility or record';
  if (/patientId does not match|patient .*not found|unknown patient/i.test(why)) return 'The patient it was for could not be found';
  if (/incomplete/i.test(why)) return 'It was incomplete';
  return why.charAt(0).toUpperCase() + why.slice(1);
}

export async function syncRoutes(fastify: FastifyInstance) {
  // Push queued offline mutations to backend (Last-Write-Wins by timestamp,
  // with tombstone deletes and a conflict log when an older write arrives
  // after a newer one already synced).
  fastify.post('/sync/push', { preHandler: [authenticate] }, async (request, reply) => {
    const { operations } = request.body as { operations: any[] };
    const authUser = getAuthUser(request);
    const isSuperAdmin = authUser.role === 'SUPER_ADMIN';

    if (!Array.isArray(operations) || operations.length === 0) {
      return { success: true, applied: [], serverTime: new Date().toISOString() };
    }

    const applied: Array<{ mutationId: string; entity: string; record: any }> = [];
    // Every operation gets an answer, so nothing waits on a device forever:
    // applied; done (nothing to do - already deleted, or a newer version is
    // already here); or rejected, with the reason, so the device stops
    // resending it and shows staff what was not saved. Only an unexpected error
    // leaves an operation queued, to be tried again.
    const done: string[] = [];
    const rejected: Array<{ mutationId: string; entity: string; recordId: string | null; reason: string }> = [];

    for (const op of operations) {
      let rejection: string | null = null;
      const reject = (message: string) => {
        rejection = message;
        fastify.log.warn(message);
      };
      let threw = false;
      try {
        const { id: mutationId, entity, payload, clinicId: opClinicId, action = 'upsert' } = op;
        if (!entity || !payload || !payload.id) {
          reject(`Rejected mutation ${mutationId}: incomplete`);
          continue;
        }

        // A mutation claiming a different clinic than the caller's own is never trusted.
        if (!isSuperAdmin && opClinicId && opClinicId !== authUser.clinicId) {
          reject(`Rejected mutation ${mutationId}: clinic ${opClinicId} does not match caller`);
          continue;
        }

        const scopedClinicId = isSuperAdmin ? (opClinicId || payload.clinicId || authUser.clinicId) : authUser.clinicId;
        const incomingUpdatedAt = deviceTime(payload.updatedAt);

        let record: any = null;

        if (entity === 'patient') {
          const existing = await prisma.patient.findUnique({ where: { id: payload.id } });
          if (existing && !isSuperAdmin && existing.clinicId !== authUser.clinicId) {
            reject(`Rejected patient mutation ${mutationId}: record belongs to another clinic`);
            continue;
          }

          if (action === 'delete') {
            if (!existing || existing.deletedAt) continue;
            record = await prisma.patient.update({ where: { id: payload.id }, data: { deletedAt: new Date() } });
            await recordAudit({ entity: 'Patient', recordId: record.id, clinicId: record.clinicId, action: 'DELETE', actorUserId: authUser.userId, actorRole: authUser.role });
          } else {
            if (existing) {
              const stale = await recordConflictIfStale({
                entity: 'Patient', recordId: payload.id, clinicId: existing.clinicId, mutationId,
                incomingUpdatedAt, currentUpdatedAt: existing.updatedAt,
              });
              if (stale) continue;
            }
            const clinicIdForRecord = existing ? existing.clinicId : scopedClinicId;

            record = await prisma.patient.upsert({
              where: { id: payload.id },
              update: {
                name: payload.name,
                phone: payload.phone,
                sex: payload.sex || null,
                dateOfBirth: payload.dateOfBirth ? new Date(payload.dateOfBirth) : null,
                dateOfBirthEstimated: !!payload.dateOfBirth && payload.dateOfBirthEstimated === true,
                village: payload.village || null,
                parish: payload.parish || null,
                subCounty: payload.subCounty || null,
                district: payload.district || null,
                nextOfKinName: payload.nextOfKinName || null,
                nextOfKinPhone: payload.nextOfKinPhone || null,
                updatedAt: incomingUpdatedAt,
              },
              create: {
                id: payload.id,
                name: payload.name,
                phone: payload.phone,
                email: isValidEmail(payload.email) ? payload.email.trim().toLowerCase() : null,
                sex: payload.sex || null,
                dateOfBirth: payload.dateOfBirth ? new Date(payload.dateOfBirth) : null,
                dateOfBirthEstimated: !!payload.dateOfBirth && payload.dateOfBirthEstimated === true,
                village: payload.village || null,
                parish: payload.parish || null,
                subCounty: payload.subCounty || null,
                district: payload.district || null,
                nextOfKinName: payload.nextOfKinName || null,
                nextOfKinPhone: payload.nextOfKinPhone || null,
                consentGivenAt: payload.consentGiven ? incomingUpdatedAt : null,
                consentGivenBy: payload.consentGiven ? authUser.userId : null,
                clinicId: clinicIdForRecord,
                createdAt: deviceTime(payload.createdAt),
                updatedAt: incomingUpdatedAt,
              },
            });
            await recordAudit({
              entity: 'Patient', recordId: record.id, clinicId: record.clinicId,
              action: existing ? 'UPDATE' : 'CREATE', actorUserId: authUser.userId, actorRole: authUser.role,
            });

            // A newly registered patient who gave an email is invited to set up
            // their portal account (this is when an offline registration
            // finally reaches the server). Never fails the sync.
            if (!existing) {
              await inviteNewPatient({
                patient: record,
                phone: record.phone,
                email: payload.email,
                actor: { userId: authUser.userId, role: authUser.role },
                log: (message) => fastify.log.info(message),
              });
            }
          }
        } else if (entity === 'appointment') {
          const existing = await prisma.appointment.findUnique({ where: { id: payload.id } });
          if (existing && !isSuperAdmin && existing.clinicId !== authUser.clinicId) {
            reject(`Rejected appointment mutation ${mutationId}: record belongs to another clinic`);
            continue;
          }

          if (action === 'delete') {
            if (!existing || existing.deletedAt) continue;
            record = await prisma.appointment.update({ where: { id: payload.id }, data: { deletedAt: new Date() } });
          } else {
            if (!existing) {
              const patient = await prisma.patient.findUnique({ where: { id: payload.patientId } });
              if (!patient || (!isSuperAdmin && patient.clinicId !== authUser.clinicId)) {
                reject(`Rejected appointment mutation ${mutationId}: patient out of scope`);
                continue;
              }
            } else {
              const stale = await recordConflictIfStale({
                entity: 'Appointment', recordId: payload.id, clinicId: existing.clinicId, mutationId,
                incomingUpdatedAt, currentUpdatedAt: existing.updatedAt,
              });
              if (stale) continue;
            }
            const clinicIdForRecord = existing ? existing.clinicId : scopedClinicId;
            // The unit must be one of this facility's; anything else leaves the visit without one.
            const departmentId = payload.departmentId
              ? (await prisma.department.findFirst({ where: { id: payload.departmentId, clinicId: clinicIdForRecord }, select: { id: true } }))?.id ?? null
              : null;

            record = await prisma.appointment.upsert({
              where: { id: payload.id },
              update: {
                date: payload.date ? new Date(payload.date) : new Date(),
                time: payload.time,
                status: payload.status || 'SCHEDULED',
                notes: payload.notes || null,
                ...(payload.checkedInAt !== undefined ? { checkedInAt: payload.checkedInAt ? deviceTime(payload.checkedInAt) : null } : {}),
                ...(payload.departmentId !== undefined ? { departmentId } : {}),
                ...(payload.awayAt !== undefined ? { awayAt: payload.awayAt ? deviceTime(payload.awayAt) : null } : {}),
                updatedAt: incomingUpdatedAt,
              },
              create: {
                id: payload.id,
                patientId: payload.patientId,
                doctorId: payload.doctorId,
                clinicId: clinicIdForRecord,
                date: payload.date ? new Date(payload.date) : new Date(),
                time: payload.time,
                status: payload.status || 'SCHEDULED',
                notes: payload.notes || null,
                checkedInAt: payload.checkedInAt ? deviceTime(payload.checkedInAt) : null,
                departmentId,
                awayAt: payload.awayAt ? deviceTime(payload.awayAt) : null,
                createdAt: deviceTime(payload.createdAt),
                updatedAt: incomingUpdatedAt,
              },
            });

            // The doctor hears about a new booking, and about a cancellation.
            const booked = !existing && record.status !== 'CANCELLED';
            const cancelled = !!existing && existing.status !== 'CANCELLED' && record.status === 'CANCELLED';
            if (booked || cancelled) {
              const bookedPatient = await prisma.patient.findUnique({ where: { id: record.patientId }, select: { name: true } });
              await notifyDoctorOfAppointment({
                clinicId: record.clinicId, doctorId: record.doctorId, actorUserId: authUser.userId,
                patientName: bookedPatient?.name ?? 'A patient', date: record.date, time: record.time, cancelled,
              }, (message) => fastify.log.warn(message));
            }
          }
        } else if (entity === 'consultation') {
          const appointment = await prisma.appointment.findUnique({ where: { id: payload.appointmentId } });
          if (!appointment || (!isSuperAdmin && appointment.clinicId !== authUser.clinicId)) {
            reject(`Rejected consultation mutation ${mutationId}: appointment out of scope`);
            continue;
          }
          if (payload.patientId !== appointment.patientId) {
            reject(`Rejected consultation mutation ${mutationId}: patientId does not match appointment`);
            continue;
          }

          const existing = await prisma.consultation.findUnique({ where: { id: payload.id } });
          if (existing && existing.patientId !== appointment.patientId) {
            reject(`Rejected consultation mutation ${mutationId}: record belongs to another patient`);
            continue;
          }

          if (action === 'delete') {
            if (!existing || existing.deletedAt) continue;
            record = await prisma.consultation.update({ where: { id: payload.id }, data: { deletedAt: new Date() } });
          } else {
            if (existing) {
              const stale = await recordConflictIfStale({
                entity: 'Consultation', recordId: payload.id, clinicId: appointment.clinicId, mutationId,
                incomingUpdatedAt, currentUpdatedAt: existing.updatedAt,
              });
              if (stale) continue;
            }

            // Saved with tests or imaging sent, to be finished when the results
            // are in: the diagnosis may still be to come.
            const awaitingResults = payload.awaitingResults === true;
            const noDiagnosisYet = awaitingResults && (payload.diagnoses === undefined || payload.diagnoses === null || (Array.isArray(payload.diagnoses) && payload.diagnoses.length === 0)) && !String(payload.diagnosis ?? '').trim();
            // Diagnoses and prescriptions are validated and reduced to known
            // fields, exactly as on the online route. An older client that only
            // sends a `diagnosis` string is upgraded to one uncoded primary.
            const validDiagnoses = noDiagnosisYet ? { ok: true as const, value: [] } : normalizeDiagnoses(payload.diagnoses, payload.diagnosis);
            if (!validDiagnoses.ok) {
              reject(`Rejected consultation mutation ${mutationId}: ${validDiagnoses.error}`);
              continue;
            }
            // `prescriptions` absent means "leave them as they are"; a list replaces them.
            const validPrescriptions = Array.isArray(payload.prescriptions) ? normalizePrescriptions(payload.prescriptions) : null;
            if (validPrescriptions && !validPrescriptions.ok) {
              reject(`Rejected consultation mutation ${mutationId}: ${validPrescriptions.error}`);
              continue;
            }
            const prescriptions = validPrescriptions?.ok ? await linkStockItems(appointment.clinicId, validPrescriptions.value) : null;
            let fee: number | null;
            try {
              fee = parseFee(payload.fee);
            } catch (error: any) {
              reject(`Rejected consultation mutation ${mutationId}: ${error.message}`);
              continue;
            }
            const diagnoses = validDiagnoses.value;
            const diagnosisText = diagnoses.length ? primaryDiagnosisText(diagnoses) : '';
            const clinicalNotes = typeof payload.clinicalNotes === 'string' ? payload.clinicalNotes.trim().slice(0, 4000) || null : undefined;
            const visitNotes = parseConsultationNotes(payload);
            if ('error' in visitNotes) {
              reject(`Rejected consultation mutation ${mutationId}: ${visitNotes.error}`);
              continue;
            }
            const { vitals: visitVitals, ...visitText } = visitNotes.value;
            const vitalsData = visitVitals === undefined ? {} : { vitals: visitVitals ?? Prisma.DbNull };

            // An older client re-sending a record it only knows as a string must
            // not flatten diagnoses a newer client already coded: leave them
            // alone unless the primary diagnosis text actually changed.
            const keepDiagnoses = !!existing && payload.diagnoses === undefined && existing.diagnosis === diagnosisText;

            // Replace, never append: a retried or edited push carries the whole
            // record, so children are rewritten in one transaction instead of
            // being added to the ones already stored (which duplicated them).
            record = await prisma.$transaction(async (tx) => {
              const saved = await tx.consultation.upsert({
                where: { id: payload.id },
                update: {
                  diagnosis: keepDiagnoses ? existing!.diagnosis : diagnosisText,
                  symptoms: payload.symptoms,
                  ...(clinicalNotes !== undefined ? { clinicalNotes } : {}),
                  ...visitText,
                  ...vitalsData,
                  serviceTags: payload.serviceTags || [],
                  awaitingResults,
                  updatedAt: incomingUpdatedAt,
                },
                create: {
                  id: payload.id,
                  appointmentId: payload.appointmentId,
                  patientId: payload.patientId,
                  recordedByUserId: authUser.userId,
                  diagnosis: diagnosisText,
                  symptoms: payload.symptoms,
                  clinicalNotes: clinicalNotes ?? null,
                  ...visitText,
                  ...vitalsData,
                  serviceTags: payload.serviceTags || [],
                  awaitingResults,
                  createdAt: deviceTime(payload.createdAt),
                  updatedAt: incomingUpdatedAt,
                },
              });
              // Seen: the patient leaves the waiting queue.
              await tx.appointment.updateMany({ where: { id: saved.appointmentId, status: 'SCHEDULED' }, data: { status: 'COMPLETED' } });
              if (!keepDiagnoses) {
                await tx.diagnosis.deleteMany({ where: { consultationId: saved.id } });
                await tx.diagnosis.createMany({ data: diagnoses.map((d) => ({ ...d, consultationId: saved.id })) });
              }
              if (prescriptions) {
                // Anything already dispensed is a record of what left the shelf and
                // is never rewritten: only the items still waiting are replaced. If
                // the incoming copy still lists a dispensed item, it is matched to
                // the stored one instead of being added again (which would put it
                // back in the pharmacist's queue and risk a second dispense).
                const dispensed = await tx.prescription.findMany({ where: { consultationId: saved.id, dispensedAt: { not: null } } });
                await tx.prescription.deleteMany({ where: { consultationId: saved.id, dispensedAt: null } });
                const signature = (rx: { medication: string; strength?: string | null; form?: string | null; dosage: string; route?: string | null; frequency: string; duration: string }) =>
                  [rx.medication, rx.strength, rx.form, rx.dosage, rx.route, rx.frequency, rx.duration].map((v) => (v ?? '').toString().trim().toLowerCase()).join('|');
                const alreadyDispensed = dispensed.map(signature);
                const toCreate = prescriptions.filter((rx) => {
                  const at = alreadyDispensed.indexOf(signature(rx));
                  if (at === -1) return true;
                  alreadyDispensed.splice(at, 1);
                  return false;
                });
                await tx.prescription.createMany({ data: toCreate.map((rx) => ({ ...rx, consultationId: saved.id })) });
              }
              // A fee recorded with the consultation becomes the facility's
              // invoice to the patient - once: a re-sent or edited copy never
              // bills again or changes an invoice that already exists.
              if (fee && !(await tx.invoice.findUnique({ where: { consultationId: saved.id }, select: { id: true } }))) {
                await tx.invoice.create({
                  data: {
                    consultationId: saved.id, patientId: saved.patientId, clinicId: appointment.clinicId, amount: fee, createdByUserId: authUser.userId,
                    items: { create: { kind: 'CONSULTATION', description: 'Consultation', quantity: 1, unitPrice: fee, amount: fee, addedByUserId: authUser.userId } },
                  },
                });
              }
              // Send the whole record back, children included: the app replaces its
              // local copy with this, so leaving them out would make a saved
              // prescription disappear from the screen until the next pull.
              return tx.consultation.findUniqueOrThrow({
                where: { id: saved.id },
                include: { ...consultationChildren, patient: { select: { name: true, phone: true } } },
              });
            });
            const prescribedCount = prescriptions?.length ?? 0;
            // Who recorded or changed the visit (which parts - never their content).
            await recordAudit({
              entity: 'Consultation', recordId: record.id, clinicId: appointment.clinicId, action: existing ? 'UPDATE' : 'CREATE',
              actorUserId: authUser.userId, actorRole: authUser.role,
              metadata: { offline: true, prescriptions: prescribedCount, ...(fee ? { fee } : {}) },
            });

            // The pharmacist hears of a new visit's prescription, and of one
            // written when a visit that waited for results is finished.
            if (!existing || (existing.awaitingResults && !awaitingResults)) {
              const consultedPatient = await prisma.patient.findUnique({ where: { id: payload.patientId }, select: { name: true } });
              await notifyNewPrescription({
                clinicId: appointment.clinicId,
                patientName: consultedPatient?.name ?? 'a patient',
                itemCount: prescribedCount,
              }, (message) => fastify.log.warn(message));
            }
          }
        } else if (entity === 'labTest') {
          const patient = await prisma.patient.findUnique({ where: { id: payload.patientId } });
          if (!patient || (!isSuperAdmin && patient.clinicId !== authUser.clinicId)) {
            reject(`Rejected labTest mutation ${mutationId}: patient out of scope`);
            continue;
          }

          const existing = await prisma.labTest.findUnique({ where: { id: payload.id } });
          if (existing && existing.patientId !== payload.patientId) {
            reject(`Rejected labTest mutation ${mutationId}: record belongs to another patient`);
            continue;
          }

          if (action === 'delete') {
            if (!existing || existing.deletedAt) continue;
            record = await prisma.labTest.update({ where: { id: payload.id }, data: { deletedAt: new Date() } });
          } else {
            if (existing) {
              const stale = await recordConflictIfStale({
                entity: 'LabTest', recordId: payload.id, clinicId: patient.clinicId, mutationId,
                incomingUpdatedAt, currentUpdatedAt: existing.updatedAt,
              });
              if (stale) continue;
            }

            // Devices send lab orders only. Results are entered, verified and
            // amended through the lab routes, which record who did each and
            // keep a verified result locked - so anything a device says about
            // results or status is ignored here.
            record = await prisma.labTest.upsert({
              where: { id: payload.id },
              update: {
                ...(existing?.status === 'PENDING' ? { testName: payload.testName } : {}),
                orderedBy: payload.orderedBy,
                updatedAt: incomingUpdatedAt,
              },
              create: {
                id: payload.id,
                patientId: payload.patientId,
                consultationId: payload.consultationId || null,
                testName: payload.testName,
                results: '',
                status: 'PENDING',
                orderedBy: payload.orderedBy,
                orderedByUserId: authUser.userId,
                createdAt: deviceTime(payload.createdAt),
                updatedAt: incomingUpdatedAt,
              },
            });

            // A new order reaches the lab - once.
            if (!existing) {
              await notifyLabOrdered({ clinicId: patient.clinicId, patientName: patient.name, testName: record.testName, orderedByUserId: authUser.userId }, (message) => fastify.log.warn(message));
            }
          }
        } else if (entity === 'imagingRequest') {
          // Requests only, once each: reports are written on the Imaging page.
          if (!worksAs(authUser, ...REQUEST_ROLES)) {
            reject(`Rejected imagingRequest mutation ${mutationId}: role may not request imaging`);
            continue;
          }
          const patient = await prisma.patient.findUnique({ where: { id: payload.patientId } });
          if (!patient || (!isSuperAdmin && patient.clinicId !== authUser.clinicId)) {
            reject(`Rejected imagingRequest mutation ${mutationId}: patient out of scope`);
            continue;
          }
          const parsed = parseImagingRequest(payload);
          if ('error' in parsed) {
            reject(`Rejected imagingRequest mutation ${mutationId}: ${parsed.error}`);
            continue;
          }
          const existing = await prisma.imagingRequest.findUnique({ where: { id: payload.id } });
          if (existing) {
            if (existing.patientId !== patient.id) continue;
            record = existing;
          } else {
            const visit = payload.consultationId ? await prisma.consultation.findFirst({ where: { id: payload.consultationId, patientId: patient.id }, select: { id: true } }) : null;
            const requester = await prisma.user.findUnique({ where: { id: authUser.userId }, select: { name: true } });
            record = await prisma.imagingRequest.create({
              data: {
                id: payload.id, ...parsed, clinicId: patient.clinicId, patientId: patient.id, consultationId: visit?.id ?? null,
                departmentId: await imagingUnitFor(patient.clinicId, parsed.modality),
                requestedBy: requester?.name ?? 'A clinician', requestedByUserId: authUser.userId,
                createdAt: deviceTime(payload.createdAt),
              },
            });
            await notifyImagingRequested({ clinicId: patient.clinicId, patientName: patient.name, examination: record.examination, urgent: record.urgent, requestedByUserId: authUser.userId }, (message) => fastify.log.warn(message));
          }
        } else if (entity === 'reproductiveHealth') {
          const patient = await prisma.patient.findUnique({ where: { id: payload.patientId } });
          if (!patient || (!isSuperAdmin && patient.clinicId !== authUser.clinicId)) {
            reject(`Rejected reproductiveHealth mutation ${mutationId}: patient out of scope`);
            continue;
          }

          const existing = await prisma.reproductiveHealthRecord.findUnique({ where: { id: payload.id } });
          if (existing && existing.patientId !== payload.patientId) {
            reject(`Rejected reproductiveHealth mutation ${mutationId}: record belongs to another patient`);
            continue;
          }

          if (action === 'delete') {
            if (!existing || existing.deletedAt) continue;
            record = await prisma.reproductiveHealthRecord.update({ where: { id: payload.id }, data: { deletedAt: new Date() } });
            await recordAudit({ entity: 'ReproductiveHealthRecord', recordId: record.id, clinicId: patient.clinicId, action: 'DELETE', actorUserId: authUser.userId, actorRole: authUser.role });
          } else {
            if (existing) {
              const stale = await recordConflictIfStale({
                entity: 'ReproductiveHealthRecord', recordId: payload.id, clinicId: patient.clinicId, mutationId,
                incomingUpdatedAt, currentUpdatedAt: existing.updatedAt,
              });
              if (stale) continue;
            }

            record = await prisma.reproductiveHealthRecord.upsert({
              where: { id: payload.id },
              update: {
                lastMenstrualPeriodDate: payload.lastMenstrualPeriodDate ? new Date(payload.lastMenstrualPeriodDate) : null,
                cycleLengthDays: payload.cycleLengthDays != null ? Number(payload.cycleLengthDays) : null,
                flowDurationDays: payload.flowDurationDays != null ? Number(payload.flowDurationDays) : null,
                familyPlanningMethod: payload.familyPlanningMethod || 'NONE',
                pregnancyStatus: payload.pregnancyStatus || 'UNKNOWN',
                gravida: payload.gravida != null ? Number(payload.gravida) : null,
                para: payload.para != null ? Number(payload.para) : null,
                notes: payload.notes || null,
                updatedAt: incomingUpdatedAt,
              },
              create: {
                id: payload.id,
                patientId: payload.patientId,
                recordedById: authUser.userId,
                lastMenstrualPeriodDate: payload.lastMenstrualPeriodDate ? new Date(payload.lastMenstrualPeriodDate) : null,
                cycleLengthDays: payload.cycleLengthDays != null ? Number(payload.cycleLengthDays) : null,
                flowDurationDays: payload.flowDurationDays != null ? Number(payload.flowDurationDays) : null,
                familyPlanningMethod: payload.familyPlanningMethod || 'NONE',
                pregnancyStatus: payload.pregnancyStatus || 'UNKNOWN',
                gravida: payload.gravida != null ? Number(payload.gravida) : null,
                para: payload.para != null ? Number(payload.para) : null,
                notes: payload.notes || null,
                createdAt: deviceTime(payload.createdAt),
                updatedAt: incomingUpdatedAt,
              },
            });
            await recordAudit({
              entity: 'ReproductiveHealthRecord', recordId: record.id, clinicId: patient.clinicId,
              action: existing ? 'UPDATE' : 'CREATE', actorUserId: authUser.userId, actorRole: authUser.role,
            });
          }
        } else if (entity === 'patientAllergies') {
          // The patient's allergy record, saved on its own (not as part of the
          // whole patient) so recording an allergy can never overwrite anything
          // else on the patient, and can be done by the clinicians who ask about
          // it. payload.id is the patient's id.
          if (!worksAs(authUser, 'NURSE', 'DOCTOR', 'PHARMACIST', 'ADMIN', 'SUPER_ADMIN')) {
            reject(`Rejected allergy mutation ${mutationId}: role ${authUser.role} may not record allergies`);
            continue;
          }
          const patient = await prisma.patient.findUnique({ where: { id: payload.id } });
          if (!patient || patient.deletedAt || (!isSuperAdmin && patient.clinicId !== authUser.clinicId)) {
            reject(`Rejected allergy mutation ${mutationId}: patient out of scope`);
            continue;
          }
          const valid = normalizeAllergies(payload.allergyStatus, payload.allergies);
          if (!valid.ok) {
            reject(`Rejected allergy mutation ${mutationId}: ${valid.error}`);
            continue;
          }
          // Last write wins by the time the allergy was recorded, not by when the
          // rest of the patient last changed, so an unrelated edit never blocks it.
          if (patient.allergiesUpdatedAt && incomingUpdatedAt < patient.allergiesUpdatedAt) {
            await recordConflictIfStale({
              entity: 'PatientAllergies', recordId: patient.id, clinicId: patient.clinicId, mutationId,
              incomingUpdatedAt, currentUpdatedAt: patient.allergiesUpdatedAt,
            });
            continue;
          }

          record = await prisma.patient.update({
            where: { id: patient.id },
            data: {
              allergyStatus: valid.value.status,
              allergies: valid.value.status === 'KNOWN' ? valid.value.allergies : Prisma.DbNull,
              allergiesUpdatedAt: incomingUpdatedAt,
              allergiesUpdatedBy: authUser.userId,
            },
          });
          // What was recorded is not written to the audit trail (allergy names are
          // health information); that it changed, and who by, is.
          await recordAudit({
            entity: 'Patient', recordId: patient.id, clinicId: patient.clinicId, action: 'UPDATE',
            actorUserId: authUser.userId, actorRole: authUser.role, metadata: { event: 'ALLERGIES_UPDATED', status: valid.value.status },
          });
        } else if (entity === 'inventory') {
          // Stock is changed by pharmacists and administrators only - offline too.
          if (!worksAs(authUser, ...STOCK_ROLES)) {
            reject(`Rejected inventory mutation ${mutationId}: ${authUser.role} cannot change stock`);
            continue;
          }
          const existing = await prisma.medicine.findUnique({ where: { id: payload.id } });
          if (existing && !isSuperAdmin && existing.clinicId !== authUser.clinicId) {
            reject(`Rejected inventory mutation ${mutationId}: record belongs to another clinic`);
            continue;
          }

          if (action === 'delete') {
            if (!existing || existing.deletedAt) continue;
            record = await prisma.$transaction((tx) => discontinueStockItem(tx, { medicineId: existing.id, note: null, clinicId: existing.clinicId, userId: authUser.userId }));
          } else if (existing) {
            // Details only. What is on the shelf changes by receiving, removing or
            // counting stock - online, where each change is recorded - never by an
            // offline copy overwriting the count.
            const stale = await recordConflictIfStale({
              entity: 'Medicine', recordId: payload.id, clinicId: existing.clinicId, mutationId,
              incomingUpdatedAt, currentUpdatedAt: existing.updatedAt,
            });
            if (stale) continue;
            let details;
            try {
              details = parseItemDetails(payload, true);
            } catch {
              reject(`Rejected inventory mutation ${mutationId}: invalid details`);
              continue;
            }
            record = await prisma.medicine.update({ where: { id: existing.id }, data: { ...details, updatedAt: incomingUpdatedAt } });
          } else {
            // Added while offline: a new item, with its opening stock recorded.
            let details;
            let quantity;
            let expiryDate;
            try {
              details = parseItemDetails(payload);
              quantity = parseCount(payload.quantity ?? 0, 'The quantity on the shelf');
              expiryDate = parseExpiry(payload.expiryDate);
            } catch {
              reject(`Rejected inventory mutation ${mutationId}: invalid stock item`);
              continue;
            }
            const created = await prisma.$transaction((tx) => createStockItem(tx, {
              ...(details as Required<typeof details>), id: payload.id, quantity, expiryDate, clinicId: scopedClinicId, userId: authUser.userId,
              createdAt: payload.createdAt ? deviceTime(payload.createdAt) : undefined,
            }));
            record = created;
            await notifyIfLowStock(created, null, (message) => fastify.log.warn(message));
          }
        }

        if (record) {
          applied.push({ mutationId, entity, record });
        }
      } catch (err: any) {
        threw = true;
        fastify.log.error(`Failed to process mutation ${op.id}: ${err.message}`);
      } finally {
        const mutationId = typeof op?.id === 'string' ? op.id : null;
        if (mutationId && !threw && !applied.some((a) => a.mutationId === mutationId)) {
          // What it depends on (its patient, its appointment) may simply not have
          // arrived yet - sent later from this device: it waits and is tried again,
          // for up to a week, before it is reported as not saved.
          const waiting = !!rejection && /out of scope/.test(rejection) && Date.now() - new Date(op.createdAt ?? 0).getTime() < DEPENDENCY_WAIT_MS;
          if (rejection && !waiting) rejected.push({ mutationId, entity: String(op.entity ?? ''), recordId: op.payload?.id ?? null, reason: syncRejectionReason(rejection) });
          else if (!rejection) done.push(mutationId);
        }
      }
    }

    // The server's clock, so the device can correct its own (see the app's lib/time.ts).
    return { success: true, applied, done, rejected, serverTime: new Date().toISOString() };
  });

  // Pull delta updates modified since lastSyncedAt (tombstoned records are
  // included so the client can remove them from its local cache too).
  fastify.get('/sync/pull', { preHandler: [authenticate] }, async (request, reply) => {
    const { clinicId: requestedClinicId, lastSyncedAt } = request.query as { clinicId: string; lastSyncedAt?: string };
    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;

    const sinceDate = lastSyncedAt ? new Date(lastSyncedAt) : new Date(0);
    const now = new Date();

    try {
      const [patients, appointments, consultations, labTests, inventory, reproductiveHealth, departments, me] = await Promise.all([
        prisma.patient.findMany({
          where: { clinicId, updatedAt: { gte: sinceDate } },
        }),
        prisma.appointment.findMany({
          where: { clinicId, updatedAt: { gte: sinceDate } },
          include: { patient: { select: { name: true, phone: true } }, doctor: { select: { name: true } } },
        }),
        prisma.consultation.findMany({
          where: { patient: { clinicId }, updatedAt: { gte: sinceDate } },
          include: { ...consultationChildren, patient: { select: { name: true, phone: true } } },
        }),
        prisma.labTest.findMany({
          where: { patient: { clinicId }, updatedAt: { gte: sinceDate } },
          include: { patient: { select: { name: true, phone: true } } },
        }),
        prisma.medicine.findMany({
          where: { clinicId, updatedAt: { gte: sinceDate } },
        }),
        prisma.reproductiveHealthRecord.findMany({
          where: { patient: { clinicId }, updatedAt: { gte: sinceDate } },
          include: { patient: { select: { name: true, phone: true } } },
        }),
        // A short list, sent whole each time: the units, closed ones too (old visits name them).
        prisma.department.findMany({ where: { clinicId }, select: { id: true, code: true, name: true, isActive: true } }),
        prisma.user.findUnique({ where: { id: getAuthUser(request).userId }, select: { departmentIds: true, extraRoles: true, canVerifyLab: true } }),
      ]);

      return {
        success: true,
        syncedAt: now.toISOString(),
        patients,
        appointments,
        consultations,
        labTests,
        inventory,
        reproductiveHealth,
        departments: sortDepartments(departments),
        myDepartmentIds: me?.departmentIds ?? [],
        // What else this person may do now, so their device shows it without signing in again.
        me: { extraRoles: me?.extraRoles ?? [], canVerifyLab: me?.canVerifyLab ?? false },
      };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });
}
