import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth.middleware';

export async function syncRoutes(fastify: FastifyInstance) {
  // Push queued offline mutations to backend (Last-Write-Wins)
  fastify.post('/sync/push', { preHandler: [authenticate] }, async (request, reply) => {
    const { operations } = request.body as { operations: any[] };

    if (!Array.isArray(operations) || operations.length === 0) {
      return { success: true, applied: [] };
    }

    const applied: Array<{ mutationId: string; entity: string; record: any }> = [];

    for (const op of operations) {
      try {
        const { id: mutationId, entity, payload } = op;
        if (!entity || !payload || !payload.id) continue;

        let record: any = null;

        if (entity === 'patient') {
          record = await prisma.patient.upsert({
            where: { id: payload.id },
            update: {
              name: payload.name,
              phone: payload.phone,
              updatedAt: payload.updatedAt ? new Date(payload.updatedAt) : new Date(),
            },
            create: {
              id: payload.id,
              name: payload.name,
              phone: payload.phone,
              clinicId: payload.clinicId,
              createdAt: payload.createdAt ? new Date(payload.createdAt) : new Date(),
              updatedAt: payload.updatedAt ? new Date(payload.updatedAt) : new Date(),
            },
          });
        } else if (entity === 'appointment') {
          record = await prisma.appointment.upsert({
            where: { id: payload.id },
            update: {
              date: payload.date ? new Date(payload.date) : new Date(),
              time: payload.time,
              status: payload.status || 'SCHEDULED',
              notes: payload.notes || null,
              updatedAt: payload.updatedAt ? new Date(payload.updatedAt) : new Date(),
            },
            create: {
              id: payload.id,
              patientId: payload.patientId,
              doctorId: payload.doctorId,
              clinicId: payload.clinicId,
              date: payload.date ? new Date(payload.date) : new Date(),
              time: payload.time,
              status: payload.status || 'SCHEDULED',
              notes: payload.notes || null,
              createdAt: payload.createdAt ? new Date(payload.createdAt) : new Date(),
              updatedAt: payload.updatedAt ? new Date(payload.updatedAt) : new Date(),
            },
          });
        } else if (entity === 'consultation') {
          record = await prisma.consultation.upsert({
            where: { id: payload.id },
            update: {
              diagnosis: payload.diagnosis,
              symptoms: payload.symptoms,
              updatedAt: payload.updatedAt ? new Date(payload.updatedAt) : new Date(),
            },
            create: {
              id: payload.id,
              appointmentId: payload.appointmentId,
              patientId: payload.patientId,
              diagnosis: payload.diagnosis,
              symptoms: payload.symptoms,
              createdAt: payload.createdAt ? new Date(payload.createdAt) : new Date(),
              updatedAt: payload.updatedAt ? new Date(payload.updatedAt) : new Date(),
            },
          });

          // Process prescriptions if present
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
        } else if (entity === 'labTest') {
          record = await prisma.labTest.upsert({
            where: { id: payload.id },
            update: {
              testName: payload.testName,
              results: payload.results || '',
              status: payload.status || 'PENDING',
              orderedBy: payload.orderedBy,
              completedAt: payload.completedAt ? new Date(payload.completedAt) : null,
              updatedAt: payload.updatedAt ? new Date(payload.updatedAt) : new Date(),
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
              updatedAt: payload.updatedAt ? new Date(payload.updatedAt) : new Date(),
            },
          });
        } else if (entity === 'inventory') {
          record = await prisma.medicine.upsert({
            where: { id: payload.id },
            update: {
              name: payload.name,
              quantity: Number(payload.quantity),
              unit: payload.unit,
              reorderLevel: Number(payload.reorderLevel),
              price: Number(payload.price),
              expiryDate: payload.expiryDate ? new Date(payload.expiryDate) : null,
              updatedAt: payload.updatedAt ? new Date(payload.updatedAt) : new Date(),
            },
            create: {
              id: payload.id,
              clinicId: payload.clinicId,
              name: payload.name,
              quantity: Number(payload.quantity),
              unit: payload.unit,
              reorderLevel: Number(payload.reorderLevel),
              price: Number(payload.price),
              expiryDate: payload.expiryDate ? new Date(payload.expiryDate) : null,
              createdAt: payload.createdAt ? new Date(payload.createdAt) : new Date(),
              updatedAt: payload.updatedAt ? new Date(payload.updatedAt) : new Date(),
            },
          });
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

  // Pull delta updates modified since lastSyncedAt
  fastify.get('/sync/pull', { preHandler: [authenticate] }, async (request, reply) => {
    const { clinicId, lastSyncedAt } = request.query as { clinicId: string; lastSyncedAt?: string };

    if (!clinicId) {
      return reply.status(400).send({ error: 'clinicId is required' });
    }

    const sinceDate = lastSyncedAt ? new Date(lastSyncedAt) : new Date(0);
    const now = new Date();

    try {
      const [patients, appointments, consultations, labTests, inventory] = await Promise.all([
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
      ]);

      return {
        success: true,
        syncedAt: now.toISOString(),
        patients,
        appointments,
        consultations,
        labTests,
        inventory,
      };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });
}

