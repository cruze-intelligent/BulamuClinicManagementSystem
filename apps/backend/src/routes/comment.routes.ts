import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate, getAuthUser } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { sendMail, feedbackSubmittedEmail, FEEDBACK_EMAIL } from '../lib/mailer';
import { notifyStaff } from '../lib/notifications';

const ENTITY_TYPES = ['FEEDBACK', 'PATIENT'] as const;

export async function commentRoutes(fastify: FastifyInstance) {
  // Cross-role notes on a record (currently patients), plus general product
  // feedback. Feedback has no entityId and is emailed to the standing Bulamu
  // inbox; record notes notify that facility's admin(s) (see NOTIFICATION_RULES).
  fastify.post('/comments', { preHandler: [authenticate] }, async (request, reply) => {
    const { entityType, entityId, body } = request.body as any;
    const authUser = getAuthUser(request);

    if (!ENTITY_TYPES.includes(entityType)) {
      return reply.status(400).send({ error: 'Invalid entityType' });
    }
    if (!body || !body.trim()) {
      return reply.status(400).send({ error: 'Comment body is required' });
    }
    if (entityType !== 'FEEDBACK' && !entityId) {
      return reply.status(400).send({ error: 'entityId is required for this entityType' });
    }

    try {
      // Confirm the target record actually belongs to the caller's facility
      // before attaching a note to it (prevents cross-facility ID guessing).
      if (entityType === 'PATIENT') {
        const patient = await prisma.patient.findUnique({ where: { id: entityId }, select: { clinicId: true } });
        if (!patient || (patient.clinicId !== authUser.clinicId && authUser.role !== 'SUPER_ADMIN')) {
          return reply.status(404).send({ error: 'Patient not found' });
        }
      }

      const author = await prisma.user.findUnique({ where: { id: authUser.userId }, include: { clinic: { select: { name: true } } } });
      if (!author) return reply.status(404).send({ error: 'User not found' });

      const comment = await prisma.comment.create({
        data: {
          clinicId: author.clinicId,
          authorId: author.id,
          authorRole: author.role,
          entityType,
          entityId: entityType === 'FEEDBACK' ? null : entityId,
          body: body.trim(),
        },
      });

      if (entityType === 'FEEDBACK') {
        await sendMail({
          to: FEEDBACK_EMAIL,
          subject: `New Bulamu feedback - ${author.clinic.name}`,
          html: feedbackSubmittedEmail(author.name, author.role, author.clinic.name, comment.body),
        });
      } else {
        // Facility admins are told about notes, in-app and (unless they opt
        // out) by a generic email - the note text itself, which can name a
        // patient, stays behind sign-in.
        const preview = comment.body.length > 140 ? `${comment.body.slice(0, 140)}...` : comment.body;
        await notifyStaff({
          type: 'NEW_NOTE',
          clinicId: author.clinicId,
          title: `New note from ${author.name}`,
          body: `${author.name} left a note on a ${entityType.toLowerCase()} record: "${preview}"`,
          link: '/patients',
          emailSummary: 'A colleague has left a note on a record at your facility. Open Bulamu to read it.',
          excludeUserId: author.id,
          log: (message) => fastify.log.warn(message),
        });
      }

      return { success: true, comment: { ...comment, authorName: author.name } };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });

  fastify.get('/comments', { preHandler: [authenticate] }, async (request, reply) => {
    const { entityType, entityId } = request.query as any;
    const authUser = getAuthUser(request);

    if (!ENTITY_TYPES.includes(entityType)) {
      return reply.status(400).send({ error: 'Invalid entityType' });
    }

    try {
      const comments = await prisma.comment.findMany({
        where: {
          clinicId: authUser.clinicId,
          entityType,
          entityId: entityType === 'FEEDBACK' ? null : entityId,
        },
        include: { author: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
      });
      return {
        success: true,
        comments: comments.map((c) => ({ id: c.id, body: c.body, authorRole: c.authorRole, authorName: c.author.name, createdAt: c.createdAt })),
      };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // All feedback across every facility, for the Facility Management console.
  fastify.get('/super-admin/feedback', { preHandler: [requireRole('SUPER_ADMIN')] }, async (_request, reply) => {
    try {
      const comments = await prisma.comment.findMany({
        where: { entityType: 'FEEDBACK' },
        include: { author: { select: { name: true } }, clinic: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return {
        success: true,
        comments: comments.map((c) => ({
          id: c.id, body: c.body, authorRole: c.authorRole, authorName: c.author.name,
          clinicName: c.clinic.name, createdAt: c.createdAt,
        })),
      };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });
}
