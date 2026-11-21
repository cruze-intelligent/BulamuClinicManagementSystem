import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireRole } from '../middleware/rbac.middleware';
import { getAuthUser } from '../middleware/auth.middleware';
import { recordAudit } from '../lib/audit';
import { buildClinicalSummary } from '../lib/clinical-summary';
import { generateClinicalSummaryPdf } from '../lib/pdf';
import { facilityLogo } from '../lib/facility-logo';
import { documentProducer } from '../lib/document-signer';
import { sendRouteError } from '../lib/http-error';
import { documentFileName, inlineDisposition } from '../lib/document-name';

// A patient's clinical summary at the facility: what clinicians read before
// seeing a patient again, or hand on. Clinical staff only; every look is logged.
const CLINICIANS = ['DOCTOR', 'NURSE', 'ADMIN'];

export async function clinicalSummaryRoutes(fastify: FastifyInstance) {
  fastify.get('/patients/:id/clinical-summary', { preHandler: [requireRole(...CLINICIANS)] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const authUser = getAuthUser(request);
    try {
      const summary = await buildClinicalSummary(id, authUser.clinicId);
      if (!summary) return reply.status(404).send({ error: 'Patient not found' });
      await recordAudit({ entity: 'ClinicalSummary', recordId: id, clinicId: authUser.clinicId, action: 'VIEW', actorUserId: authUser.userId, actorRole: authUser.role });
      return { success: true, summary };
    } catch (error) {
      return sendRouteError(reply, error);
    }
  });

  fastify.get('/patients/:id/clinical-summary/pdf', { preHandler: [requireRole(...CLINICIANS)] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const authUser = getAuthUser(request);
    try {
      const summary = await buildClinicalSummary(id, authUser.clinicId);
      if (!summary) return reply.status(404).send({ error: 'Patient not found' });
      const clinic = await prisma.clinic.findUniqueOrThrow({ where: { id: authUser.clinicId }, select: { name: true, facilityCode: true, phone: true, motto: true } });
      const pdf = await generateClinicalSummaryPdf({
        clinicName: clinic.name, facilityCode: clinic.facilityCode, clinicPhone: clinic.phone, clinicMotto: clinic.motto,
        clinicLogo: await facilityLogo(authUser.clinicId), summary, producedBy: await documentProducer(authUser.userId),
      });
      await recordAudit({ entity: 'ClinicalSummary', recordId: id, clinicId: authUser.clinicId, action: 'VIEW', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { format: 'pdf' } });
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', inlineDisposition(documentFileName('Clinical summary', summary.patient.name, new Date())));
      return reply.send(pdf);
    } catch (error) {
      return sendRouteError(reply, error);
    }
  });
}
