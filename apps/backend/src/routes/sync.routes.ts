import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate, getAuthUser, resolveClinicScope } from '../middleware/auth.middleware';
import { recordConflictIfStale } from '../lib/conflict';
import { recordAudit } from '../lib/audit';

export async function syncRoutes(fastify: FastifyInstance) {
  // Push queued offline mutations to backend (Last-Write-Wins by timestamp,
  // with tombstone deletes and a conflict log when an older write arrives
  // after a newer one already synced).
  fastify.post('/sync/push', { preHandler: [authenticate] }, async (request, reply) => {
    const { operations } = request.body as { operations: any[] };
    const authUser = getAuthUser(request);
    const isSuperAdmin = authUser.role === 'SUPER_ADMIN';

    if (!Array.isArray(operations) || operations.length === 0) {
      return { success: true, applied: [] };
    }

    const applied: Array<{ mutationId: string; entity: string; record: any }> = [];

    for (const op of operations) {
      try {
        const { id: mutationId, entity, payload, clinicId: opClinicId, action = 'upsert' } = op;
        if (!entity || !payload || !payload.id) continue;

        // A mutation claiming a different clinic than the caller's own is never trusted.
        if (!isSuperAdmin && opClinicId && opClinicId !== authUser.clinicId) {
          fastify.log.warn(`Rejected mutation ${mutationId}: clinic ${opClinicId} does not match caller`);
          continue;
        }

        const scopedClinicId = isSuperAdmin ? (opClinicId || payload.clinicId || authUser.clinicId) : authUser.clinicId;
        const incomingUpdatedAt = payload.updatedAt ? new Date(payload.updatedAt) : new Date();

        let record: any = null;

        if (entity === 'patient') {
          const existing = await prisma.patient.findUnique({ where: { id: payload.id } });
          if (existing && !isSuperAdmin && existing.clinicId !== authUser.clinicId) {
            fastify.log.warn(`Rejected patient mutation ${mutationId}: record belongs to another clinic`);
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
                sex: payload.sex || null,
                dateOfBirth: payload.dateOfBirth ? new Date(payload.dateOfBirth) : null,
                village: payload.village || null,
                parish: payload.parish || null,
                subCounty: payload.subCounty || null,
                district: payload.district || null,
                nextOfKinName: payload.nextOfKinName || null,
                nextOfKinPhone: payload.nextOfKinPhone || null,
                consentGivenAt: payload.consentGiven ? incomingUpdatedAt : null,
                consentGivenBy: payload.consentGiven ? authUser.userId : null,
                clinicId: clinicIdForRecord,
                createdAt: payload.createdAt ? new Date(payload.createdAt) : new Date(),
                updatedAt: incomingUpdatedAt,
              },
            });
            await recordAudit({
              entity: 'Patient', recordId: record.id, clinicId: record.clinicId,
              action: existing ? 'UPDATE' : 'CREATE', actorUserId: authUser.userId, actorRole: authUser.role,
            });
          }
        } else if (entity === 'appointment') {
          const existing = await prisma.appointment.findUnique({ where: { id: payload.id } });
          if (existing && !isSuperAdmin && existing.clinicId !== authUser.clinicId) {
            fastify.log.warn(`Rejected appointment mutation ${mutationId}: record belongs to another clinic`);
            continue;
          }

          if (action === 'delete') {
            if (!existing || existing.deletedAt) continue;
            record = await prisma.appointment.update({ where: { id: payload.id }, data: { deletedAt: new Date() } });
          } else {
            if (!existing) {
              const patient = await prisma.patient.findUnique({ where: { id: payload.patientId } });
              if (!patient || (!isSuperAdmin && patient.clinicId !== authUser.clinicId)) {
                fastify.log.warn(`Rejected appointment mutation ${mutationId}: patient out of scope`);
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

            record = await prisma.appointment.upsert({
              where: { id: payload.id },
              update: {
                date: payload.date ? new Date(payload.date) : new Date(),
                time: payload.time,
                status: payload.status || 'SCHEDULED',
                notes: payload.notes || null,
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
                createdAt: payload.createdAt ? new Date(payload.createdAt) : new Date(),
                updatedAt: incomingUpdatedAt,
              },
            });
          }
        } else if (entity === 'consultation') {
          const appointment = await prisma.appointment.findUnique({ where: { id: payload.appointmentId } });
          if (!appointment || (!isSuperAdmin && appointment.clinicId !== authUser.clinicId)) {
            fastify.log.warn(`Rejected consultation mutation ${mutationId}: appointment out of scope`);
            continue;
          }
          if (payload.patientId !== appointment.patientId) {
            fastify.log.warn(`Rejected consultation mutation ${mutationId}: patientId does not match appointment`);
            continue;
          }

          const existing = await prisma.consultation.findUnique({ where: { id: payload.id } });
          if (existing && existing.patientId !== appointment.patientId) {
            fastify.log.warn(`Rejected consultation mutation ${mutationId}: record belongs to another patient`);
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

            record = await prisma.consultation.upsert({
              where: { id: payload.id },
              update: {
                diagnosis: payload.diagnosis,
                symptoms: payload.symptoms,
                serviceTags: payload.serviceTags || [],
                updatedAt: incomingUpdatedAt,
              },
              create: {
                id: payload.id,
                appointmentId: payload.appointmentId,
                patientId: payload.patientId,
                diagnosis: payload.diagnosis,
                symptoms: payload.symptoms,
                serviceTags: payload.serviceTags || [],
                createdAt: payload.createdAt ? new Date(payload.createdAt) : new Date(),
                updatedAt: incomingUpdatedAt,
              },
            });

            if (Array.isArray(payload.prescriptions)) {
              for (const rx of payload.prescriptions) {
                if (rx.medication) {
                  await prisma.prescription.create({
                    data: {
                      consultationId: record.id,
                      medication: rx.medication,
                      dosage: rx.dosage || '',
                      frequency: rx.frequency || '',
                      duration: rx.duration || '',
                    },
                  });
                }
              }
            }
          }
        } else if (entity === 'labTest') {
          const patient = await prisma.patient.findUnique({ where: { id: payload.patientId } });
          if (!patient || (!isSuperAdmin && patient.clinicId !== authUser.clinicId)) {
            fastify.log.warn(`Rejected labTest mutation ${mutationId}: patient out of scope`);
            continue;
          }

          const existing = await prisma.labTest.findUnique({ where: { id: payload.id } });
          if (existing && existing.patientId !== payload.patientId) {
            fastify.log.warn(`Rejected labTest mutation ${mutationId}: record belongs to another patient`);
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

            record = await prisma.labTest.upsert({
              where: { id: payload.id },
              update: {
                testName: payload.testName,
                results: payload.results || '',
                status: payload.status || 'PENDING',
                orderedBy: payload.orderedBy,
                completedAt: payload.completedAt ? new Date(payload.completedAt) : null,
                updatedAt: incomingUpdatedAt,
              },
              create: {
                id: payload.id,
                patientId: payload.patientId,
                consultationId: payload.consultationId || null,
                testName: payload.testName,
                results: payload.results || '',
                status: payload.status || 'PENDING',
                orderedBy: payload.orderedBy,
                completedAt: payload.completedAt ? new Date(payload.completedAt) : null,
                createdAt: payload.createdAt ? new Date(payload.createdAt) : new Date(),
                updatedAt: incomingUpdatedAt,
              },
            });
          }
        } else if (entity === 'reproductiveHealth') {
          const patient = await prisma.patient.findUnique({ where: { id: payload.patientId } });
          if (!patient || (!isSuperAdmin && patient.clinicId !== authUser.clinicId)) {
            fastify.log.warn(`Rejected reproductiveHealth mutation ${mutationId}: patient out of scope`);
            continue;
          }

          const existing = await prisma.reproductiveHealthRecord.findUnique({ where: { id: payload.id } });
          if (existing && existing.patientId !== payload.patientId) {
            fastify.log.warn(`Rejected reproductiveHealth mutation ${mutationId}: record belongs to another patient`);
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
                recordedById: payload.recordedById || authUser.userId,
                lastMenstrualPeriodDate: payload.lastMenstrualPeriodDate ? new Date(payload.lastMenstrualPeriodDate) : null,
                cycleLengthDays: payload.cycleLengthDays != null ? Number(payload.cycleLengthDays) : null,
                flowDurationDays: payload.flowDurationDays != null ? Number(payload.flowDurationDays) : null,
                familyPlanningMethod: payload.familyPlanningMethod || 'NONE',
                pregnancyStatus: payload.pregnancyStatus || 'UNKNOWN',
                gravida: payload.gravida != null ? Number(payload.gravida) : null,
                para: payload.para != null ? Number(payload.para) : null,
                notes: payload.notes || null,
                createdAt: payload.createdAt ? new Date(payload.createdAt) : new Date(),
                updatedAt: incomingUpdatedAt,
              },
            });
            await recordAudit({
              entity: 'ReproductiveHealthRecord', recordId: record.id, clinicId: patient.clinicId,
              action: existing ? 'UPDATE' : 'CREATE', actorUserId: authUser.userId, actorRole: authUser.role,
            });
          }
        } else if (entity === 'inventory') {
          const existing = await prisma.medicine.findUnique({ where: { id: payload.id } });
          if (existing && !isSuperAdmin && existing.clinicId !== authUser.clinicId) {
            fastify.log.warn(`Rejected inventory mutation ${mutationId}: record belongs to another clinic`);
            continue;
          }

          if (action === 'delete') {
            if (!existing || existing.deletedAt) continue;
            record = await prisma.medicine.update({ where: { id: payload.id }, data: { deletedAt: new Date() } });
          } else {
            if (existing) {
              const stale = await recordConflictIfStale({
                entity: 'Medicine', recordId: payload.id, clinicId: existing.clinicId, mutationId,
                incomingUpdatedAt, currentUpdatedAt: existing.updatedAt,
              });
              if (stale) continue;
            }
            const clinicIdForRecord = existing ? existing.clinicId : scopedClinicId;

            record = await prisma.medicine.upsert({
              where: { id: payload.id },
              update: {
                name: payload.name,
                quantity: Number(payload.quantity),
                unit: payload.unit,
                reorderLevel: Number(payload.reorderLevel),
                price: Number(payload.price),
                expiryDate: payload.expiryDate ? new Date(payload.expiryDate) : null,
                updatedAt: incomingUpdatedAt,
              },
              create: {
                id: payload.id,
                clinicId: clinicIdForRecord,
                name: payload.name,
                quantity: Number(payload.quantity),
                unit: payload.unit,
                reorderLevel: Number(payload.reorderLevel),
                price: Number(payload.price),
                expiryDate: payload.expiryDate ? new Date(payload.expiryDate) : null,
                createdAt: payload.createdAt ? new Date(payload.createdAt) : new Date(),
                updatedAt: incomingUpdatedAt,
              },
            });
          }
        }

        if (record) {
          applied.push({ mutationId, entity, record });
        }
      } catch (err: any) {
        fastify.log.error(`Failed to process mutation ${op.id}: ${err.message}`);
      }
    }

    return { success: true, applied };
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
      const [patients, appointments, consultations, labTests, inventory, reproductiveHealth] = await Promise.all([
        prisma.patient.findMany({
          where: { clinicId, updatedAt: { gte: sinceDate } },
        }),
        prisma.appointment.findMany({
          where: { clinicId, updatedAt: { gte: sinceDate } },
          include: { patient: { select: { name: true, phone: true } }, doctor: { select: { name: true } } },
        }),
        prisma.consultation.findMany({
          where: { patient: { clinicId }, updatedAt: { gte: sinceDate } },
          include: { prescriptions: true, patient: { select: { name: true, phone: true } } },
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
      };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });
}
