import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticate, getAuthUser, worksAs } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { authenticatePatient, getPatientAuthUser } from '../middleware/patient-auth.middleware';
import { HttpError } from '../lib/http-error';

const PAGE_SIZE = 30;
const MAX_BODY = 2000;

function sanitizeBody(raw: unknown): string {
  if (typeof raw !== 'string') throw new HttpError(400, 'Message body is required');
  const trimmed = raw.trim();
  if (!trimmed) throw new HttpError(400, 'Message body is required');
  if (trimmed.length > MAX_BODY) throw new HttpError(400, `Message must be at most ${MAX_BODY} characters`);
  return trimmed;
}

// Present a thread for the staff list view
function presentThread(thread: any, viewerUserId?: string) {
  const lastMsg = thread.messages?.[0] ?? null;
  const unread = thread._count?.messages ?? 0;
  return {
    id: thread.id,
    kind: thread.kind,
    clinicId: thread.clinicId,
    updatedAt: thread.updatedAt,
    userA: thread.userA ? { id: thread.userA.id, name: thread.userA.name, role: thread.userA.role } : null,
    userB: thread.userB ? { id: thread.userB.id, name: thread.userB.name, role: thread.userB.role } : null,
    patientAccount: thread.patientAccount ? { id: thread.patientAccount.id } : null,
    lastMessage: lastMsg ? { body: lastMsg.body, createdAt: lastMsg.createdAt, authorUserId: lastMsg.authorUserId, authorPatientAccountId: lastMsg.authorPatientAccountId } : null,
    unreadCount: unread,
  };
}

async function patientChatClinicIds(patientAccountId: string): Promise<string[]> {
  const [account, grants] = await Promise.all([
    prisma.patientAccount.findUnique({ where: { id: patientAccountId }, select: { createdByClinicId: true } }),
    prisma.patientAccessGrant.findMany({ where: { patientAccountId, revokedAt: null }, select: { clinicId: true } }),
  ]);
  return account ? [...new Set([account.createdByClinicId, ...grants.map((grant) => grant.clinicId)])] : [];
}

async function findPatientChatThread(id: string, patientAccountId: string) {
  const thread = await prisma.chatThread.findFirst({ where: { id, kind: 'PATIENT_STAFF', patientAccountId }, select: { id: true, clinicId: true } });
  if (!thread?.clinicId || !(await patientChatClinicIds(patientAccountId)).includes(thread.clinicId)) return null;
  return thread;
}
async function findAccessiblePatientThread(id: string, clinicId: string) {
  return prisma.chatThread.findFirst({
    where: {
      id,
      clinicId,
      kind: 'PATIENT_STAFF',
      patientAccount: { is: { OR: [
        { createdByClinicId: clinicId },
        { accessGrants: { some: { clinicId, revokedAt: null } } },
      ] } },
    },
    select: { id: true, clinicId: true, kind: true },
  });
}
function presentMessage(msg: any) {
  return {
    id: msg.id,
    threadId: msg.threadId,
    body: msg.body,
    createdAt: msg.createdAt,
    readAt: msg.readAt,
    authorUserId: msg.authorUserId,
    authorName: msg.authorUser?.name ?? msg.authorPatientAccount?.email ?? null,
    authorPatientAccountId: msg.authorPatientAccountId,
  };
}

export async function chatRoutes(fastify: FastifyInstance) {

  // ─── Staff: unread count ────────────────────────────────────────────────
  fastify.get('/chat/unread-count', { preHandler: [authenticate] }, async (request) => {
    const authUser = getAuthUser(request);
    const staffCount = await prisma.chatMessage.count({
      where: {
        authorUserId: { not: authUser.userId },
        authorPatientAccountId: null,
        readAt: null,
        thread: { kind: 'STAFF_STAFF', clinicId: authUser.clinicId, OR: [{ userAId: authUser.userId }, { userBId: authUser.userId }] },
      },
    });
    const supportCount = worksAs(authUser, 'ADMIN') ? await prisma.chatMessage.count({
      where: { readAt: null, authorUser: { is: { role: 'SUPER_ADMIN' } }, thread: { kind: 'ADMIN_SUPER', clinicId: authUser.clinicId } },
    }) : 0;
    const patientCount = worksAs(authUser, 'DOCTOR', 'NURSE', 'ADMIN') ? await prisma.chatMessage.count({
      where: {
        authorPatientAccountId: { not: null },
        readAt: null,
        thread: { kind: 'PATIENT_STAFF', clinicId: authUser.clinicId, OR: [
          { patientAccount: { is: { createdByClinicId: authUser.clinicId } } },
          { patientAccount: { is: { accessGrants: { some: { clinicId: authUser.clinicId, revokedAt: null } } } } },
        ] },
      },
    }) : 0;
    return { success: true, count: staffCount + supportCount + patientCount };
  });
  fastify.get('/chat/staff', { preHandler: [authenticate] }, async (request) => {
    const authUser = getAuthUser(request);
    const users = await prisma.user.findMany({
      where: { clinicId: authUser.clinicId, isActive: true, id: { not: authUser.userId } },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    });
    return { success: true, users };
  });
  fastify.get('/chat/threads', { preHandler: [authenticate] }, async (request) => {
    const authUser = getAuthUser(request);
    const { userId } = authUser;
    const threads = await prisma.chatThread.findMany({
      where: {
        clinicId: authUser.clinicId,
        kind: { in: ['STAFF_STAFF', 'ADMIN_SUPER'] },
        OR: [{ userAId: userId }, { userBId: userId }, ...(worksAs(authUser, 'ADMIN') ? [{ kind: 'ADMIN_SUPER' as const }] : [])],
      },
      include: {
        userA: { select: { id: true, name: true, role: true } },
        userB: { select: { id: true, name: true, role: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: {
          select: {
            messages: {
              where: { authorUserId: { not: userId }, readAt: null },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return { success: true, threads: threads.map((t) => presentThread(t, userId)) };
  });

  // ─── Staff: open or find a DM ──────────────────────────────────────────
  fastify.post('/chat/threads', { preHandler: [authenticate] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { toUserId } = request.body as any;
    if (!toUserId || typeof toUserId !== 'string') return reply.status(400).send({ error: 'toUserId is required' });
    if (toUserId === authUser.userId) return reply.status(400).send({ error: 'You cannot message yourself' });

    const toUser = await prisma.user.findUnique({ where: { id: toUserId }, select: { id: true, clinicId: true, isActive: true, name: true, role: true } });
    if (!toUser || toUser.clinicId !== authUser.clinicId || !toUser.isActive) {
      return reply.status(404).send({ error: 'Staff member not found' });
    }

    // Normalize pair so the unique index holds regardless of who starts
    const [userAId, userBId] = [authUser.userId, toUserId].sort();

    const thread = await prisma.chatThread.upsert({
      where: { clinicId_userAId_userBId: { clinicId: authUser.clinicId, userAId, userBId } },
      create: { clinicId: authUser.clinicId, kind: 'STAFF_STAFF', userAId, userBId },
      update: {},
      include: {
        userA: { select: { id: true, name: true, role: true } },
        userB: { select: { id: true, name: true, role: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { messages: { where: { authorUser: { is: { role: 'SUPER_ADMIN' } }, readAt: null } } } },
      },
    });
    return { success: true, thread: presentThread(thread, authUser.userId) };
  });

  // ─── Staff: messages in a DM/support thread ────────────────────────────
  fastify.get('/chat/threads/:id/messages', { preHandler: [authenticate] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as any;
    const { before } = request.query as any;

    const thread = await prisma.chatThread.findUnique({ where: { id }, select: { id: true, kind: true, clinicId: true, userAId: true, userBId: true } });
    if (!thread || thread.clinicId !== authUser.clinicId || !['STAFF_STAFF', 'ADMIN_SUPER'].includes(thread.kind) || (thread.kind === 'STAFF_STAFF' && thread.userAId !== authUser.userId && thread.userBId !== authUser.userId) || (thread.kind === 'ADMIN_SUPER' && !worksAs(authUser, 'ADMIN'))) {
      return reply.status(404).send({ error: 'Thread not found' });
    }
    const messages = await prisma.chatMessage.findMany({
      where: { threadId: id, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      include: { authorUser: { select: { name: true } } },
    });
    return { success: true, messages: messages.map(presentMessage) };
  });

  // ─── Staff: send message in a DM/support thread ────────────────────────
  fastify.post('/chat/threads/:id/messages', { preHandler: [authenticate] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as any;
    let body: string;
    try { body = sanitizeBody((request.body as any)?.body); } catch (e: any) { return reply.status(400).send({ error: e.message }); }

    const thread = await prisma.chatThread.findUnique({ where: { id }, select: { id: true, kind: true, userAId: true, userBId: true, clinicId: true } });
    if (!thread || thread.clinicId !== authUser.clinicId || !['STAFF_STAFF', 'ADMIN_SUPER'].includes(thread.kind) || (thread.kind === 'STAFF_STAFF' && thread.userAId !== authUser.userId && thread.userBId !== authUser.userId) || (thread.kind === 'ADMIN_SUPER' && !worksAs(authUser, 'ADMIN'))) {
      return reply.status(404).send({ error: 'Thread not found' });
    }

    const [msg] = await prisma.$transaction([
      prisma.chatMessage.create({
        data: { threadId: id, authorUserId: authUser.userId, body },
        include: { authorUser: { select: { name: true } } },
      }),
      prisma.chatThread.update({ where: { id }, data: { updatedAt: new Date() } }),
    ]);
    return { success: true, message: presentMessage(msg) };
  });

  // ─── Staff: mark thread read ───────────────────────────────────────────
  fastify.post('/chat/threads/:id/read', { preHandler: [authenticate] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as any;
    const thread = await prisma.chatThread.findUnique({ where: { id }, select: { kind: true, clinicId: true, userAId: true, userBId: true } });
    if (!thread || thread.clinicId !== authUser.clinicId || !['STAFF_STAFF', 'ADMIN_SUPER'].includes(thread.kind) || (thread.kind === 'STAFF_STAFF' && thread.userAId !== authUser.userId && thread.userBId !== authUser.userId) || (thread.kind === 'ADMIN_SUPER' && !worksAs(authUser, 'ADMIN'))) {
      return reply.status(404).send({ error: 'Thread not found' });
    }
    await prisma.chatMessage.updateMany({
      where: thread.kind === 'ADMIN_SUPER' ? { threadId: id, authorUser: { is: { role: 'SUPER_ADMIN' } }, readAt: null } : { threadId: id, authorUserId: { not: authUser.userId }, readAt: null },
      data: { readAt: new Date() },
    });
    return { success: true };
  });

  // ─── Admin: open/find support thread with Bulamu ───────────────────────
  fastify.post('/chat/admin-support', { preHandler: [requireRole('ADMIN')] }, async (request) => {
    const authUser = getAuthUser(request);
    // ADMIN_SUPER threads: userAId = admin, userBId = null, clinicId = clinic
    // The unique index is on (clinicId, userAId, userBId); userBId null so one per clinic-admin pair.
    const existing = await prisma.chatThread.findFirst({
      where: { kind: 'ADMIN_SUPER', clinicId: authUser.clinicId },
      include: {
        userA: { select: { id: true, name: true, role: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { messages: { where: { authorUser: { is: { role: 'SUPER_ADMIN' } }, readAt: null } } } },
      },
    });
    if (existing) return { success: true, thread: presentThread(existing, authUser.userId) };

    const thread = await prisma.chatThread.create({
      data: { clinicId: authUser.clinicId, kind: 'ADMIN_SUPER', userAId: authUser.userId },
      include: {
        userA: { select: { id: true, name: true, role: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { messages: { where: { authorUser: { is: { role: 'SUPER_ADMIN' } }, readAt: null } } } },
      },
    });
    return { success: true, thread: presentThread(thread, authUser.userId) };
  });

  // ─── Super-admin: support inbox ────────────────────────────────────────
  fastify.get('/chat/super-admin/threads', { preHandler: [requireRole('SUPER_ADMIN')] }, async () => {
    const threads = await prisma.chatThread.findMany({
      where: { kind: 'ADMIN_SUPER' },
      include: {
        userA: { select: { id: true, name: true, role: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { messages: { where: { authorUserId: { not: null }, authorUser: { is: { role: { not: 'SUPER_ADMIN' } } }, readAt: null } } } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    // Attach clinic name
    const clinicIds = [...new Set(threads.map((t) => t.clinicId).filter(Boolean) as string[])];
    const clinics = await prisma.clinic.findMany({ where: { id: { in: clinicIds } }, select: { id: true, name: true } });
    const clinicMap = Object.fromEntries(clinics.map((c) => [c.id, c.name]));
    return {
      success: true,
      threads: threads.map((t) => ({ ...presentThread(t), clinicName: t.clinicId ? (clinicMap[t.clinicId] ?? null) : null })),
    };
  });

  fastify.get('/chat/super-admin/unread-count', { preHandler: [requireRole('SUPER_ADMIN')] }, async () => {
    // Unread = messages authored by facility users (not by super-admin, authorUserId set but not SA)
    const count = await prisma.chatMessage.count({
      where: { thread: { kind: 'ADMIN_SUPER' }, authorUser: { is: { role: { not: 'SUPER_ADMIN' } } }, readAt: null },
    });
    return { success: true, count };
  });

  fastify.get('/chat/super-admin/threads/:id/messages', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
    const { id } = request.params as any;
    const { before } = request.query as any;
    const thread = await prisma.chatThread.findUnique({ where: { id }, select: { kind: true } });
    if (!thread || thread.kind !== 'ADMIN_SUPER') return reply.status(404).send({ error: 'Thread not found' });
    const messages = await prisma.chatMessage.findMany({
      where: { threadId: id, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      include: { authorUser: { select: { name: true } } },
    });
    return { success: true, messages: messages.map(presentMessage) };
  });

  fastify.post('/chat/super-admin/threads/:id/messages', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as any;
    let body: string;
    try { body = sanitizeBody((request.body as any)?.body); } catch (e: any) { return reply.status(400).send({ error: e.message }); }
    const thread = await prisma.chatThread.findUnique({ where: { id }, select: { kind: true } });
    if (!thread || thread.kind !== 'ADMIN_SUPER') return reply.status(404).send({ error: 'Thread not found' });
    const [msg] = await prisma.$transaction([
      prisma.chatMessage.create({
        data: { threadId: id, authorUserId: authUser.userId, body },
        include: { authorUser: { select: { name: true } } },
      }),
      prisma.chatThread.update({ where: { id }, data: { updatedAt: new Date() } }),
    ]);
    return { success: true, message: presentMessage(msg) };
  });
  fastify.post('/chat/super-admin/threads/:id/read', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
    const { id } = request.params as any;
    const thread = await prisma.chatThread.findUnique({ where: { id }, select: { kind: true } });
    if (!thread || thread.kind !== 'ADMIN_SUPER') return reply.status(404).send({ error: 'Thread not found' });
    await prisma.chatMessage.updateMany({
      where: { threadId: id, authorUser: { is: { role: { not: 'SUPER_ADMIN' } } }, readAt: null },
      data: { readAt: new Date() },
    });
    return { success: true };
  });

  fastify.get('/patient-portal/chat/unread-count', { preHandler: [authenticatePatient] }, async (request) => {
    const { patientAccountId } = getPatientAuthUser(request);
    const count = await prisma.chatMessage.count({ where: { authorUserId: { not: null }, readAt: null, thread: { kind: 'PATIENT_STAFF', patientAccountId, clinicId: { in: await patientChatClinicIds(patientAccountId) } } } });
    return { success: true, count };
  });

  fastify.get('/patient-portal/chat/clinics', { preHandler: [authenticatePatient] }, async (request) => {
    const { patientAccountId } = getPatientAuthUser(request);
    const account = await prisma.patientAccount.findUnique({ where: { id: patientAccountId }, select: { createdByClinicId: true } });
    if (!account) return { success: true, clinics: [] };
    const grants = await prisma.patientAccessGrant.findMany({ where: { patientAccountId, revokedAt: null }, select: { clinicId: true } });
    const ids = [...new Set([account.createdByClinicId, ...grants.map((grant) => grant.clinicId)])];
    const clinics = await prisma.clinic.findMany({ where: { id: { in: ids }, isActive: true, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    return { success: true, clinics };
  });

  fastify.get('/patient-portal/chat/threads', { preHandler: [authenticatePatient] }, async (request) => {
    const { patientAccountId } = getPatientAuthUser(request);
    const allowedClinicIds = await patientChatClinicIds(patientAccountId);
    const threads = await prisma.chatThread.findMany({ where: { kind: 'PATIENT_STAFF', patientAccountId, clinicId: { in: allowedClinicIds } }, include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 }, _count: { select: { messages: { where: { authorUserId: { not: null }, readAt: null } } } } }, orderBy: { updatedAt: 'desc' } });
    const clinicIds = [...new Set(threads.map((thread) => thread.clinicId).filter(Boolean) as string[])];
    const clinics = await prisma.clinic.findMany({ where: { id: { in: clinicIds } }, select: { id: true, name: true } });
    const clinicMap = Object.fromEntries(clinics.map((clinic) => [clinic.id, clinic.name]));
    return { success: true, threads: threads.map((thread) => ({ id: thread.id, kind: thread.kind, clinicId: thread.clinicId, clinicName: thread.clinicId ? clinicMap[thread.clinicId] ?? null : null, updatedAt: thread.updatedAt, lastMessage: thread.messages[0] ? { body: thread.messages[0].body, createdAt: thread.messages[0].createdAt } : null, unreadCount: thread._count.messages })) };
  });

  fastify.post('/patient-portal/chat/threads', { preHandler: [authenticatePatient] }, async (request, reply) => {
    const { patientAccountId } = getPatientAuthUser(request);
    const { clinicId } = request.body as any;
    if (typeof clinicId !== 'string' || !clinicId) return reply.status(400).send({ error: 'clinicId is required' });
    const account = await prisma.patientAccount.findUnique({ where: { id: patientAccountId }, select: { createdByClinicId: true } });
    if (!account) return reply.status(404).send({ error: 'Account not found' });
    const grant = account.createdByClinicId === clinicId ? true : !!(await prisma.patientAccessGrant.findFirst({ where: { patientAccountId, clinicId, revokedAt: null } }));
    if (!grant) return reply.status(403).send({ error: 'You do not have an active link with this clinic' });
    const seedUser = await prisma.user.findFirst({ where: { clinicId, isActive: true, role: { in: ['ADMIN', 'DOCTOR', 'NURSE'] } }, orderBy: { role: 'asc' }, select: { id: true } });
    if (!seedUser) return reply.status(404).send({ error: 'No staff available at this clinic' });
    const thread = await prisma.chatThread.upsert({
      where: { patientAccountId_clinicId_kind: { patientAccountId, clinicId, kind: 'PATIENT_STAFF' } },
      create: { clinicId, kind: 'PATIENT_STAFF', userAId: seedUser.id, patientAccountId },
      update: {},
    });
    const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { name: true } });
    return { success: true, thread: { id: thread.id, kind: thread.kind, clinicId: thread.clinicId, clinicName: clinic?.name ?? null, updatedAt: thread.updatedAt } };
  });

  fastify.get('/patient-portal/chat/threads/:id/messages', { preHandler: [authenticatePatient] }, async (request, reply) => {
    const { patientAccountId } = getPatientAuthUser(request);
    const { id } = request.params as any;
    const { before } = request.query as any;
    const thread = await findPatientChatThread(id, patientAccountId);
    if (!thread) return reply.status(404).send({ error: 'Thread not found' });
    const messages = await prisma.chatMessage.findMany({ where: { threadId: id, ...(before ? { createdAt: { lt: new Date(before) } } : {}) }, orderBy: { createdAt: 'desc' }, take: PAGE_SIZE, include: { authorUser: { select: { name: true } } } });
    return { success: true, messages: messages.map(presentMessage) };
  });

  fastify.post('/patient-portal/chat/threads/:id/messages', { preHandler: [authenticatePatient] }, async (request, reply) => {
    const { patientAccountId } = getPatientAuthUser(request);
    const { id } = request.params as any;
    let body: string;
    try { body = sanitizeBody((request.body as any)?.body); } catch (error: any) { return reply.status(400).send({ error: error.message }); }
    const thread = await findPatientChatThread(id, patientAccountId);
    if (!thread) return reply.status(404).send({ error: 'Thread not found' });
    const [message] = await prisma.$transaction([
      prisma.chatMessage.create({ data: { threadId: id, authorPatientAccountId: patientAccountId, body }, include: { authorPatientAccount: { select: { email: true } } } }),
      prisma.chatThread.update({ where: { id }, data: { updatedAt: new Date() } }),
    ]);
    return { success: true, message: presentMessage(message) };
  });

  fastify.post('/patient-portal/chat/threads/:id/read', { preHandler: [authenticatePatient] }, async (request, reply) => {
    const { patientAccountId } = getPatientAuthUser(request);
    const { id } = request.params as any;
    const thread = await findPatientChatThread(id, patientAccountId);
    if (!thread) return reply.status(404).send({ error: 'Thread not found' });
    await prisma.chatMessage.updateMany({ where: { threadId: id, authorUserId: { not: null }, readAt: null }, data: { readAt: new Date() } });
    return { success: true };
  });

  fastify.get('/chat/patient-threads', { preHandler: [requireRole('DOCTOR', 'NURSE', 'ADMIN')] }, async (request) => {
    const authUser = getAuthUser(request);
    const threads = await prisma.chatThread.findMany({
      where: { kind: 'PATIENT_STAFF', clinicId: authUser.clinicId, OR: [{ patientAccount: { is: { createdByClinicId: authUser.clinicId } } }, { patientAccount: { is: { accessGrants: { some: { clinicId: authUser.clinicId, revokedAt: null } } } } }] },
      include: { patientAccount: { select: { id: true, email: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 }, _count: { select: { messages: { where: { authorPatientAccountId: { not: null }, readAt: null } } } } },
      orderBy: { updatedAt: 'desc' },
    });
    return { success: true, threads: threads.map((thread) => ({ id: thread.id, kind: thread.kind, clinicId: thread.clinicId, patientAccount: thread.patientAccount, updatedAt: thread.updatedAt, lastMessage: thread.messages[0] ? { body: thread.messages[0].body, createdAt: thread.messages[0].createdAt, authorUserId: thread.messages[0].authorUserId } : null, unreadCount: thread._count.messages })) };
  });

  fastify.get('/chat/patient-threads/:id/messages', { preHandler: [requireRole('DOCTOR', 'NURSE', 'ADMIN')] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as any;
    const { before } = request.query as any;
    const thread = await findAccessiblePatientThread(id, authUser.clinicId);
    if (!thread) return reply.status(404).send({ error: 'Thread not found' });
    const messages = await prisma.chatMessage.findMany({ where: { threadId: id, ...(before ? { createdAt: { lt: new Date(before) } } : {}) }, orderBy: { createdAt: 'desc' }, take: PAGE_SIZE, include: { authorUser: { select: { name: true } }, authorPatientAccount: { select: { email: true } } } });
    return { success: true, messages: messages.map(presentMessage) };
  });

  fastify.post('/chat/patient-threads/:id/messages', { preHandler: [requireRole('DOCTOR', 'NURSE', 'ADMIN')] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as any;
    let body: string;
    try { body = sanitizeBody((request.body as any)?.body); } catch (error: any) { return reply.status(400).send({ error: error.message }); }
    if (!await findAccessiblePatientThread(id, authUser.clinicId)) return reply.status(404).send({ error: 'Thread not found' });
    const [message] = await prisma.$transaction([
      prisma.chatMessage.create({ data: { threadId: id, authorUserId: authUser.userId, body }, include: { authorUser: { select: { name: true } } } }),
      prisma.chatThread.update({ where: { id }, data: { updatedAt: new Date() } }),
    ]);
    return { success: true, message: presentMessage(message) };
  });

  fastify.post('/chat/patient-threads/:id/read', { preHandler: [requireRole('DOCTOR', 'NURSE', 'ADMIN')] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as any;
    if (!await findAccessiblePatientThread(id, authUser.clinicId)) return reply.status(404).send({ error: 'Thread not found' });
    await prisma.chatMessage.updateMany({ where: { threadId: id, authorPatientAccountId: { not: null }, readAt: null }, data: { readAt: new Date() } });
    return { success: true };
  });
}