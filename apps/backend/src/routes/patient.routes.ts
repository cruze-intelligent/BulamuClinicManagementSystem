import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate, resolveClinicScope, assertClinicMatch, getAuthUser } from '../middleware/auth.middleware';
import { recordAudit } from '../lib/audit';
import { requireRole } from '../middleware/rbac.middleware';

export async function patientRoutes(fastify: FastifyInstance) {

  // Create patient (protected)
  fastify.post('/patients', { preHandler: [authenticate] }, async (request, reply) => {
    const {
      name,
      phone,
      clinicId: requestedClinicId,
      sex,
      dateOfBirth,
      village,
      parish,
      subCounty,
      district,
      nextOfKinName,
      nextOfKinPhone,
      consentGiven,
    } = request.body as any;
    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;

    const authUser = getAuthUser(request);

    try {
      const patient = await prisma.patient.create({
        data: {
          name,
          phone,
          clinicId,
          sex: sex || null,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
          village: village || null,
          parish: parish || null,
          subCounty: subCounty || null,
          district: district || null,
          nextOfKinName: nextOfKinName || null,
          nextOfKinPhone: nextOfKinPhone || null,
          consentGivenAt: consentGiven ? new Date() : null,
          consentGivenBy: consentGiven ? authUser.userId : null,
        }
      });

      await recordAudit({
        entity: 'Patient', recordId: patient.id, clinicId: patient.clinicId,
        action: 'CREATE', actorUserId: authUser.userId, actorRole: authUser.role,
      });

      return { success: true, patient };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });

  // Get all patients for a clinic (protected)
  fastify.get('/patients/:clinicId', { preHandler: [authenticate] }, async (request, reply) => {
    const { clinicId: requestedClinicId } = request.params as any;
    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;

    try {
      const patients = await prisma.patient.findMany({
        where: { clinicId, deletedAt: null },
        orderBy: { createdAt: 'desc' }
      });

      return { success: true, patients, count: patients.length };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // Soft-delete a patient record (ADMIN only - a real EMR record is never hard-deleted)
  fastify.delete('/patients/:id', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const { id } = request.params as any;

    try {
      const existing = await prisma.patient.findUnique({ where: { id } });
      if (!existing || existing.deletedAt) {
        return reply.status(404).send({ error: 'Patient not found' });
      }
      if (!assertClinicMatch(request, reply, existing.clinicId)) return;

      const patient = await prisma.patient.update({ where: { id }, data: { deletedAt: new Date() } });

      const authUser = getAuthUser(request);
      await recordAudit({
        entity: 'Patient', recordId: patient.id, clinicId: patient.clinicId,
        action: 'DELETE', actorUserId: authUser.userId, actorRole: authUser.role,
      });

      return { success: true, patient };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });
}