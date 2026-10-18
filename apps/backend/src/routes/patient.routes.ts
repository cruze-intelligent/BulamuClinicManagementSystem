import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate, resolveClinicScope, assertClinicMatch, getAuthUser } from '../middleware/auth.middleware';
import { recordAudit } from '../lib/audit';
import { requireRole } from '../middleware/rbac.middleware';
import { inviteNewPatient, isValidEmail } from '../lib/portal-invite';
import { parsePatientDetails } from '../lib/patient-details';
import { sendRouteError } from '../lib/http-error';

export async function patientRoutes(fastify: FastifyInstance) {

  // Create patient (protected)
  fastify.post('/patients', { preHandler: [authenticate] }, async (request, reply) => {
    const {
      name,
      phone,
      email,
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
          email: isValidEmail(email) ? email.trim().toLowerCase() : null,
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

      // If the patient gave an email, invite them to set up their portal
      // account. Never fails the registration itself.
      const portalInvitation = await inviteNewPatient({
        patient,
        phone,
        email,
        actor: { userId: authUser.userId, role: authUser.role },
        log: (message) => fastify.log.info(message),
      });

      return { success: true, patient, ...(portalInvitation ? { portalInvitation } : {}) };
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
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
      return sendRouteError(reply, error);
    }
  });

  // Get a single patient record directly (protected) - avoids fetching the
  // whole clinic patient list just to find one, which doesn't scale as a
  // facility's patient count grows.
  fastify.get('/patients/record/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as any;

    try {
      const patient = await prisma.patient.findUnique({ where: { id } });
      if (!patient || patient.deletedAt) {
        return reply.status(404).send({ error: 'Patient not found' });
      }
      if (!assertClinicMatch(request, reply, patient.clinicId)) return;

      return { success: true, patient };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // Correct a patient's registration details (name, phone, address, next of
  // kin...). Clinical records are never edited here. The change is audited
  // (which fields, not their values) and reaches devices on their next sync.
  fastify.patch('/patients/:id', { preHandler: [requireRole('ADMIN', 'DOCTOR', 'NURSE', 'STAFF')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;

    try {
      const existing = await prisma.patient.findUnique({ where: { id } });
      if (!existing || existing.deletedAt) {
        return reply.status(404).send({ error: 'Patient not found' });
      }
      if (!assertClinicMatch(request, reply, existing.clinicId)) return;

      const parsed = parsePatientDetails(body);
      if ('error' in parsed) return reply.status(400).send({ error: parsed.error });

      const changed = (Object.keys(parsed.data) as Array<keyof typeof parsed.data>).filter((key) => {
        const before = existing[key] instanceof Date ? (existing[key] as Date).toISOString().slice(0, 10) : existing[key];
        const after = parsed.data[key] instanceof Date ? (parsed.data[key] as Date).toISOString().slice(0, 10) : parsed.data[key];
        return before !== after;
      });
      if (changed.length === 0) return { success: true, patient: existing };

      const data = Object.fromEntries(changed.map((key) => [key, parsed.data[key]]));
      const patient = await prisma.patient.update({ where: { id }, data });

      const authUser = getAuthUser(request);
      await recordAudit({
        entity: 'Patient', recordId: patient.id, clinicId: patient.clinicId,
        action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { fields: changed },
      });

      return { success: true, patient };
    } catch (error: any) {
      return sendRouteError(reply, error, 400);
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
      return sendRouteError(reply, error, 400);
    }
  });
}