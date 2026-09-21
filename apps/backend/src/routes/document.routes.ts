import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate, assertClinicMatch, getAuthUser } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { recordAudit } from '../lib/audit';
import { generateStorageKey, saveFile, getFileStream, deleteFile } from '../lib/storage';
import { detectDocumentFormat, normalizeFileName, setDownloadHeaders, withFormat, SUPPORTED_FORMATS_MESSAGE } from '../lib/document-format';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_CATEGORIES = ['LAB_RESULT', 'CONSENT_FORM', 'ID_COPY', 'REFERRAL_LETTER', 'OTHER'];

export async function documentRoutes(fastify: FastifyInstance) {
  // Upload a document attached to a patient record
  fastify.post(
    '/patients/:patientId/documents',
    { preHandler: [requireRole('NURSE', 'DOCTOR', 'ADMIN')] },
    async (request, reply) => {
      const { patientId } = request.params as any;

      const patient = await prisma.patient.findUnique({ where: { id: patientId } });
      if (!patient) return reply.status(404).send({ error: 'Patient not found' });
      if (!assertClinicMatch(request, reply, patient.clinicId)) return;

      const data = await request.file({ limits: { fileSize: MAX_FILE_SIZE_BYTES } });
      if (!data) return reply.status(400).send({ error: 'No file uploaded' });

      const category = (data.fields?.category as any)?.value;
      const resolvedCategory = ALLOWED_CATEGORIES.includes(category) ? category : 'OTHER';

      let buffer: Buffer;
      try {
        buffer = await data.toBuffer();
      } catch (err: any) {
        return reply.status(413).send({ error: 'File too large (10MB max)' });
      }

      // Decide the type from the file's own bytes, not from what the browser claimed.
      const format = detectDocumentFormat(buffer, data.filename);
      if (!format) return reply.status(415).send({ error: SUPPORTED_FORMATS_MESSAGE });
      const fileName = normalizeFileName(data.filename, format);

      const authUser = getAuthUser(request);
      const storageKey = generateStorageKey(fileName);
      await saveFile(storageKey, buffer);

      const document = await prisma.document.create({
        data: {
          clinicId: patient.clinicId,
          patientId: patient.id,
          category: resolvedCategory,
          fileName,
          mimeType: format.mimeType,
          fileSize: buffer.length,
          storageKey,
          uploadedByUserId: authUser.userId,
        },
      });

      await recordAudit({
        entity: 'Document', recordId: document.id, clinicId: document.clinicId,
        action: 'CREATE', actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { patientId: patient.id, fileName: document.fileName },
      });

      return { success: true, document: withFormat(document) };
    }
  );

  // List documents attached to a patient
  fastify.get('/patients/:patientId/documents', { preHandler: [authenticate] }, async (request, reply) => {
    const { patientId } = request.params as any;

    const patient = await prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) return reply.status(404).send({ error: 'Patient not found' });
    if (!assertClinicMatch(request, reply, patient.clinicId)) return;

    const documents = await prisma.document.findMany({
      where: { patientId },
      include: {
        uploadedBy: { select: { name: true } },
        uploadedByPatientAccount: { select: { portableId: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { success: true, documents: documents.map(withFormat) };
  });

  // Download a document's underlying file
  fastify.get('/documents/:id/download', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as any;

    const document = await prisma.document.findUnique({ where: { id } });
    if (!document) return reply.status(404).send({ error: 'Document not found' });
    if (!assertClinicMatch(request, reply, document.clinicId)) return;

    setDownloadHeaders(reply, document);
    return reply.send(getFileStream(document.storageKey));
  });

  // Delete a document (uploader or ADMIN only)
  fastify.delete('/documents/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as any;
    const authUser = getAuthUser(request);

    const document = await prisma.document.findUnique({ where: { id } });
    if (!document) return reply.status(404).send({ error: 'Document not found' });
    if (!assertClinicMatch(request, reply, document.clinicId)) return;

    if (document.uploadedByUserId !== authUser.userId && authUser.role !== 'ADMIN' && authUser.role !== 'SUPER_ADMIN') {
      return reply.status(403).send({ error: 'Access denied: only the uploader or an admin can delete this document' });
    }

    await deleteFile(document.storageKey);
    await prisma.document.delete({ where: { id } });

    await recordAudit({
      entity: 'Document', recordId: document.id, clinicId: document.clinicId,
      action: 'DELETE', actorUserId: authUser.userId, actorRole: authUser.role,
      metadata: { fileName: document.fileName },
    });

    return { success: true };
  });
}
