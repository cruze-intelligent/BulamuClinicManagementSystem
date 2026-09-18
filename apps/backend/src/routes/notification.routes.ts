import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate, getAuthUser } from '../middleware/auth.middleware';
import { authenticatePatient, getPatientAuthUser } from '../middleware/patient-auth.middleware';
import {
  describePreferences, listNotifications, markAllRead, markRead, sanitizeOptOuts, unreadCount, Recipient,
} from '../lib/notifications';

export async function notificationRoutes(fastify: FastifyInstance) {
  // ---- Staff -----------------------------------------------------------------
  const staffRecipient = (request: any): Recipient => ({ userId: getAuthUser(request).userId });

  fastify.get('/notifications', { preHandler: [authenticate] }, async (request) => {
    const { limit } = request.query as any;
    const result = await listNotifications(staffRecipient(request), Number(limit) || 50);
    return { success: true, ...result };
  });

  // Polled by the sidebar badge, so kept to a single cheap count query.
  fastify.get('/notifications/unread-count', { preHandler: [authenticate] }, async (request) => {
    return { success: true, count: await unreadCount(staffRecipient(request)) };
  });

  fastify.post('/notifications/read-all', { preHandler: [authenticate] }, async (request) => {
    await markAllRead(staffRecipient(request));
    return { success: true };
  });

  fastify.post('/notifications/:id/read', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as any;
    if (!(await markRead(staffRecipient(request), id))) {
      return reply.status(404).send({ error: 'Notification not found' });
    }
    return { success: true };
  });

  fastify.get('/notifications/preferences', { preHandler: [authenticate] }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: getAuthUser(request).userId }, select: { role: true, emailOptOuts: true } });
    if (!user) return reply.status(404).send({ error: 'User not found' });
    return { success: true, preferences: describePreferences({ role: user.role }, user.emailOptOuts) };
  });

  fastify.put('/notifications/preferences', { preHandler: [authenticate] }, async (request, reply) => {
    const { emailDisabled } = request.body as any;
    const user = await prisma.user.findUnique({ where: { id: getAuthUser(request).userId }, select: { id: true, role: true } });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const emailOptOuts = sanitizeOptOuts({ role: user.role }, emailDisabled);
    await prisma.user.update({ where: { id: user.id }, data: { emailOptOuts } });
    return { success: true, preferences: describePreferences({ role: user.role }, emailOptOuts) };
  });

  // ---- Patients (their own portal account) -----------------------------------
  const patientRecipient = (request: any): Recipient => ({ patientAccountId: getPatientAuthUser(request).patientAccountId });

  fastify.get('/patient-portal/notifications', { preHandler: [authenticatePatient] }, async (request) => {
    const { limit } = request.query as any;
    const result = await listNotifications(patientRecipient(request), Number(limit) || 50);
    return { success: true, ...result };
  });

  fastify.get('/patient-portal/notifications/unread-count', { preHandler: [authenticatePatient] }, async (request) => {
    return { success: true, count: await unreadCount(patientRecipient(request)) };
  });

  fastify.post('/patient-portal/notifications/read-all', { preHandler: [authenticatePatient] }, async (request) => {
    await markAllRead(patientRecipient(request));
    return { success: true };
  });

  fastify.post('/patient-portal/notifications/:id/read', { preHandler: [authenticatePatient] }, async (request, reply) => {
    const { id } = request.params as any;
    if (!(await markRead(patientRecipient(request), id))) {
      return reply.status(404).send({ error: 'Notification not found' });
    }
    return { success: true };
  });

  fastify.get('/patient-portal/notifications/preferences', { preHandler: [authenticatePatient] }, async (request, reply) => {
    const account = await prisma.patientAccount.findUnique({
      where: { id: getPatientAuthUser(request).patientAccountId },
      select: { emailOptOuts: true },
    });
    if (!account) return reply.status(404).send({ error: 'Account not found' });
    return { success: true, preferences: describePreferences({ patient: true }, account.emailOptOuts) };
  });

  fastify.put('/patient-portal/notifications/preferences', { preHandler: [authenticatePatient] }, async (request) => {
    const { emailDisabled } = request.body as any;
    const patientAccountId = getPatientAuthUser(request).patientAccountId;
    const emailOptOuts = sanitizeOptOuts({ patient: true }, emailDisabled);
    await prisma.patientAccount.update({ where: { id: patientAccountId }, data: { emailOptOuts } });
    return { success: true, preferences: describePreferences({ patient: true }, emailOptOuts) };
  });
}
