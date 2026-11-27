import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { authenticate, getAuthUser } from '../middleware/auth.middleware';
import { authenticatePatient, getPatientAuthUser } from '../middleware/patient-auth.middleware';
import { prisma } from '../lib/prisma';

const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 5000;
const NOTE_FIELDS = { id: true, title: true, body: true, reminderAt: true, completedAt: true, createdAt: true, updatedAt: true } as const;
type NoteOwner = { userId: string | null; patientAccountId: string | null };

function noteText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function optionalTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const title = value.trim();
  return title.length <= MAX_TITLE_LENGTH ? title : null;
}

function reminderDate(value: unknown): { valid: boolean; date: Date | null } {
  if (value === null || value === '') return { valid: true, date: null };
  if (typeof value !== 'string') return { valid: false, date: null };
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? { valid: false, date: null } : { valid: true, date };
}

function registerOwnerRoutes(
  fastify: FastifyInstance,
  basePath: string,
  preHandler: preHandlerAsyncHookHandler,
  getOwner: (request: FastifyRequest) => NoteOwner,
) {
  const options = { preHandler: [preHandler] };

  fastify.get(basePath, options, async (request) => {
    const owner = getOwner(request);
    const notes = await prisma.personalNote.findMany({
      where: owner,
      select: NOTE_FIELDS,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return { success: true, notes };
  });

  fastify.get(`${basePath}/due-count`, options, async (request) => {
    const owner = getOwner(request);
    const count = await prisma.personalNote.count({ where: { ...owner, reminderAt: { lte: new Date() }, completedAt: null } });
    return { success: true, count };
  });

  fastify.post(basePath, options, async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const title = body.title === undefined ? '' : optionalTitle(body.title);
    const text = noteText(body.body, MAX_BODY_LENGTH);
    const reminder = reminderDate(body.reminderAt);

    if (title === null) return reply.status(400).send({ error: `Keep the title to ${MAX_TITLE_LENGTH} characters or fewer` });
    if (!text) return reply.status(400).send({ error: 'Add at least one note or reminder item' });
    if (!reminder.valid) return reply.status(400).send({ error: 'Choose a valid reminder date and time' });

    const note = await prisma.personalNote.create({
      data: { ...getOwner(request), title, body: text, reminderAt: reminder.date },
      select: NOTE_FIELDS,
    });
    return reply.status(201).send({ success: true, note });
  });

  fastify.patch(`${basePath}/:id`, options, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const owner = getOwner(request);
    const data: { title?: string; body?: string; reminderAt?: Date | null; completedAt?: Date | null } = {};

    if (body.title !== undefined) {
      const title = optionalTitle(body.title);
      if (title === null) return reply.status(400).send({ error: `Keep the title to ${MAX_TITLE_LENGTH} characters or fewer` });
      data.title = title;
    }
    if (body.body !== undefined) {
      const text = noteText(body.body, MAX_BODY_LENGTH);
      if (!text) return reply.status(400).send({ error: 'Add at least one note or reminder item' });
      data.body = text;
    }
    if (body.reminderAt !== undefined) {
      const reminder = reminderDate(body.reminderAt);
      if (!reminder.valid) return reply.status(400).send({ error: 'Choose a valid reminder date and time' });
      data.reminderAt = reminder.date;
    }
    if (body.completed !== undefined) {
      if (typeof body.completed !== 'boolean') return reply.status(400).send({ error: 'Choose whether this reminder is complete' });
      data.completedAt = body.completed ? new Date() : null;
    }
    if (Object.keys(data).length === 0) return reply.status(400).send({ error: 'There is nothing to update' });

    const updated = await prisma.personalNote.updateMany({ where: { id, ...owner }, data });
    if (updated.count === 0) return reply.status(404).send({ error: 'Note not found' });

    const note = await prisma.personalNote.findFirst({ where: { id, ...owner }, select: NOTE_FIELDS });
    return { success: true, note };
  });

  fastify.delete(`${basePath}/:id`, options, async (request, reply) => {
    const { id } = request.params as { id: string };
    const owner = getOwner(request);
    const deleted = await prisma.personalNote.deleteMany({ where: { id, ...owner } });
    if (deleted.count === 0) return reply.status(404).send({ error: 'Note not found' });
    return { success: true };
  });
}

export async function personalNotesRoutes(fastify: FastifyInstance) {
  registerOwnerRoutes(fastify, '/notes', authenticate, (request) => ({
    userId: getAuthUser(request).userId,
    patientAccountId: null,
  }));
  registerOwnerRoutes(fastify, '/patient-portal/notes', authenticatePatient, (request) => ({
    userId: null,
    patientAccountId: getPatientAuthUser(request).patientAccountId,
  }));
}
