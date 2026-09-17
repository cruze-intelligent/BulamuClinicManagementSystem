import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate, getAuthUser } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { sendMail, feedbackSubmittedEmail, newCommentEmail, FEEDBACK_EMAIL } from '../lib/mailer';

const ENTITY_TYPES = ['FEEDBACK', 'PATIENT'] as const;

export async function commentRoutes(fastify: FastifyInstance) {
  // Cross-role notes on a record (currently patients), plus general product
  // feedback. Feedback has no entityId and is emailed to the standing Bulamu
  // inbox; record notes are emailed to that facility's admin(s).
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
        const recipients = await prisma.user.findMany({
          where: { clinicId: author.clinicId, role: 'ADMIN', isActive: true, id: { not: author.id } },
          select: { email: true },
        });
        const consoleUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/patients`;
        for (const recipient of recipients) {
          await sendMail({
            to: recipient.email,
            subject: `New note from ${author.name}`,
            html: newCommentEmail(author.name, author.role, entityType, comment.body, consoleUrl),
          });
        }
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
