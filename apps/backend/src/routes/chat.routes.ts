import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { isUniqueConstraintError, prisma } from '../lib/prisma';
import { authenticate, getAuthUser, worksAs } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { authenticatePatient, getPatientAuthUser } from '../middleware/patient-auth.middleware';
import { HttpError } from '../lib/http-error';
import { ADMIN_NOTIFY_EMAIL, chatroomMessageEmail, sendMail } from '../lib/mailer';

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
function presentThread(thread: any, viewerUserId?: string, dynamicMembers?: Array<{ id: string; name: string; role: string }>, unreadOverride?: number) {
  const lastMsg = thread.messages?.[0] ?? null;
  const unread = unreadOverride ?? thread._count?.messages ?? 0;
  return {
    id: thread.id,
    kind: thread.kind,
    clinicId: thread.clinicId,
    groupType: thread.groupType ?? null,
    groupName: thread.groupName ?? null,
    groupRole: thread.groupRole ?? null,
    members: dynamicMembers ?? thread.members?.map((entry: any) => entry.user) ?? [],
    isPinned: !!thread.pins?.length,
    updatedAt: thread.updatedAt,
    userA: thread.userA ? { id: thread.userA.id, name: thread.userA.name, role: thread.userA.role } : null,
    userB: thread.userB ? { id: thread.userB.id, name: thread.userB.name, role: thread.userB.role } : null,
    patientAccount: thread.patientAccount ? { id: thread.patientAccount.id } : null,
    lastMessage: lastMsg ? { body: lastMsg.body, createdAt: lastMsg.createdAt, authorUserId: lastMsg.authorUserId, authorPatientAccountId: lastMsg.authorPatientAccountId } : null,
    unreadCount: unread,
  };
}

function hasRole(authUser: { role: string; extraRoles?: string[] }, role: string) {
  return authUser.role === role || (authUser.extraRoles ?? []).includes(role);
}

function rejectAttachments(body: any) {
  if (body && (Object.hasOwn(body, 'attachment') || Object.hasOwn(body, 'attachments'))) {
    throw new HttpError(400, 'Chatroom does not accept attachments');
  }
}

async function findStaffThread(id: string, authUser: ReturnType<typeof getAuthUser>) {
  const thread = await prisma.chatThread.findUnique({
    where: { id },
    include: { members: { select: { userId: true } } },
  });
  if (!thread || thread.clinicId !== authUser.clinicId) return null;
  // Platform admins use only the dedicated support inbox, even if their
  // account record happens to carry a facility id.
  if (worksAs(authUser, 'SUPER_ADMIN')) return null;
  if (thread.kind === 'STAFF_STAFF') return thread.userAId === authUser.userId || thread.userBId === authUser.userId ? thread : null;
  if (thread.kind === 'ADMIN_SUPER') return worksAs(authUser, 'ADMIN') ? thread : null;
  if (thread.kind !== 'STAFF_GROUP') return null;
  if (thread.groupType === 'FACILITY') return thread;
  if (thread.groupType === 'ROLE') return thread.groupRole && hasRole(authUser, thread.groupRole) ? thread : null;
  return thread.members.some((member) => member.userId === authUser.userId) ? thread : null;
}

function messageInput(requestBody: any, threadKind: string): { body: string; emailRequested: boolean } {
  rejectAttachments(requestBody);
  if (requestBody?.sendEmail !== undefined && typeof requestBody.sendEmail !== 'boolean') {
    throw new HttpError(400, 'sendEmail must be true or false');
  }
  const emailRequested = requestBody?.sendEmail === true;
  if (emailRequested && threadKind !== 'ADMIN_SUPER') {
    throw new HttpError(400, 'Email notices are only available in Bulamu Support conversations');
  }
  return { body: sanitizeBody(requestBody?.body), emailRequested };
}

async function sendSupportEmail(input: { threadId: string; clinicId: string; senderName: string; fromSuperAdmin: boolean }) {
  const clinic = await prisma.clinic.findUnique({ where: { id: input.clinicId }, select: { name: true } });
  const frontend = process.env.FRONTEND_URL || 'https://bulamu.site';
  const inboxPath = input.fromSuperAdmin ? '/super-admin/messages/' : '/messages/';
  const inboxUrl = new URL(inboxPath, frontend);
  inboxUrl.searchParams.set('threadId', input.threadId);
  const notice = (recipientName: string) => chatroomMessageEmail({
    recipientName,
    senderName: input.senderName,
    facilityName: clinic?.name ?? 'your facility',
    inboxUrl: inboxUrl.toString(),
  });

  if (input.fromSuperAdmin) {
    const admins = await prisma.user.findMany({
      where: { clinicId: input.clinicId, role: 'ADMIN', isActive: true },
      select: { email: true, name: true },
    });
    if (!admins.length) return { sent: false, reason: 'No active facility administrators are available' };
    const results = await Promise.all(admins.map((admin) => sendMail({
      to: admin.email,
      subject: 'New secure message in Bulamu Chatroom',
      html: notice(admin.name),
    })));
    return { sent: results.every((result) => result.sent), recipients: results.length };
  }
  const result = await sendMail({
    to: ADMIN_NOTIFY_EMAIL,
    subject: 'New secure message in Bulamu Chatroom',
    html: notice('Bulamu Support'),
  });
  return { sent: result.sent, reason: result.reason };
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

  async function unreadSupportCount(threadId: string, sentBySuperAdmin: boolean, lastReadAt?: Date) {
    return prisma.chatMessage.count({
      where: {
        threadId,
        authorUser: { is: sentBySuperAdmin ? { role: 'SUPER_ADMIN' } : { role: { not: 'SUPER_ADMIN' } } },
        ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
      },
    });
  }

  async function saveThreadRead(threadId: string, userId: string) {
    const latest = await prisma.chatMessage.aggregate({ where: { threadId }, _max: { createdAt: true } });
    const lastReadAt = latest._max.createdAt ?? new Date();
    await prisma.chatThreadRead.upsert({
      where: { threadId_userId: { threadId, userId } },
      create: { threadId, userId, lastReadAt },
      update: { lastReadAt },
    });
    return lastReadAt;
  }

  // ─── Staff: unread count ────────────────────────────────────────────────
  fastify.get('/chat/unread-count', { preHandler: [authenticate] }, async (request) => {
    const authUser = getAuthUser(request);
    if (worksAs(authUser, 'SUPER_ADMIN')) return { success: true, count: 0 };
    const roles = [...new Set([authUser.role, ...(authUser.extraRoles ?? [])])] as Role[];
    const [staffCount, groupThreads] = await Promise.all([prisma.chatMessage.count({
      where: {
        authorUserId: { not: authUser.userId },
        authorPatientAccountId: null,
        readAt: null,
        thread: {
          clinicId: authUser.clinicId,
          kind: 'STAFF_STAFF',
          OR: [{ userAId: authUser.userId }, { userBId: authUser.userId }],
        },
      },
    }), prisma.chatThread.findMany({
      where: {
        clinicId: authUser.clinicId,
        kind: 'STAFF_GROUP',
        OR: [
          { groupType: 'FACILITY' },
          ...(roles.length ? [{ groupType: 'ROLE' as const, groupRole: { in: roles } }] : []),
          { groupType: 'CUSTOM', members: { some: { userId: authUser.userId } } },
        ],
      },
      select: { id: true, createdAt: true, reads: { where: { userId: authUser.userId }, select: { lastReadAt: true } } },
    })]);
    const groupCount = (await Promise.all(groupThreads.map((thread) => prisma.chatMessage.count({
      where: {
        threadId: thread.id,
        authorUserId: { not: authUser.userId },
        ...(thread.reads[0] ? { createdAt: { gt: thread.reads[0].lastReadAt } } : { createdAt: { gte: thread.createdAt } }),
      },
    })))).reduce((sum, count) => sum + count, 0);
    const supportThreads = worksAs(authUser, 'ADMIN') ? await prisma.chatThread.findMany({
      where: { kind: 'ADMIN_SUPER', clinicId: authUser.clinicId },
      select: { id: true, reads: { where: { userId: authUser.userId }, select: { lastReadAt: true } } },
    }) : [];
    const supportCount = (await Promise.all(supportThreads.map((thread) => unreadSupportCount(thread.id, true, thread.reads[0]?.lastReadAt)))).reduce((sum, count) => sum + count, 0);
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
    return { success: true, count: staffCount + groupCount + supportCount + patientCount };
  });
  fastify.get('/chat/staff', { preHandler: [authenticate] }, async (request) => {
    const authUser = getAuthUser(request);
    if (worksAs(authUser, 'SUPER_ADMIN')) return { success: true, users: [] };
    const users = await prisma.user.findMany({
      where: { clinicId: authUser.clinicId, isActive: true, role: { not: 'SUPER_ADMIN' }, id: { not: authUser.userId } },
      select: { id: true, name: true, role: true, extraRoles: true },
      orderBy: { name: 'asc' },
    });
    return { success: true, users };
  });

  fastify.post('/chat/groups', { preHandler: [authenticate] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    if (worksAs(authUser, 'SUPER_ADMIN')) return reply.status(403).send({ error: 'Platform administrators use Bulamu Support' });
    const input = request.body as any;
    const groupType = input?.groupType;
    if (!['FACILITY', 'ROLE', 'CUSTOM'].includes(groupType)) return reply.status(400).send({ error: 'Choose a facility, role, or custom group' });

    let groupName: string;
    let groupRole: Role | null = null;
    let memberIds: string[] = [];
    if (groupType === 'FACILITY') {
      groupName = 'All staff';
    } else if (groupType === 'ROLE') {
      const allowedRoles = ['ADMIN', 'DOCTOR', 'NURSE', 'PHARMACIST', 'STAFF', 'LAB_TECH', 'RADIOGRAPHER'];
      if (!allowedRoles.includes(input?.groupRole)) return reply.status(400).send({ error: 'Choose a facility role for this room' });
      groupRole = input.groupRole as Role;
      groupName = `${groupRole.replaceAll('_', ' ')} team`;
    } else {
      groupName = typeof input?.name === 'string' ? input.name.trim().slice(0, 60) : '';
      const rawIds = Array.isArray(input?.memberIds) ? input.memberIds : [];
      if (!groupName) return reply.status(400).send({ error: 'Give this group a name' });
      if (rawIds.length > 30 || rawIds.some((id: unknown) => typeof id !== 'string')) return reply.status(400).send({ error: 'Choose up to 30 staff members' });
      memberIds = [...new Set([authUser.userId, ...rawIds])];
      const members = await prisma.user.findMany({ where: { id: { in: memberIds }, clinicId: authUser.clinicId, isActive: true, role: { not: 'SUPER_ADMIN' } }, select: { id: true } });
      if (members.length !== memberIds.length) return reply.status(400).send({ error: 'Every group member must be active staff at your facility' });
    }

    const uniqueRoom = groupType !== 'CUSTOM';
    const where = { clinicId: authUser.clinicId, kind: 'STAFF_GROUP' as const, groupType, ...(groupRole ? { groupRole } : {}) };
    if (uniqueRoom) {
      const existing = await prisma.chatThread.findFirst({ where, include: { members: { include: { user: { select: { id: true, name: true, role: true } } } }, pins: { where: { userId: authUser.userId } } } });
      if (existing) return { success: true, thread: presentThread(existing, authUser.userId) };
    }

    try {
      const thread = await prisma.chatThread.create({
        data: {
          clinicId: authUser.clinicId,
          kind: 'STAFF_GROUP',
          userAId: authUser.userId,
          groupType,
          groupName,
          groupRole,
          ...(groupType === 'CUSTOM' ? { members: { createMany: { data: memberIds.map((userId) => ({ userId })) } } } : {}),
        },
        include: { members: { include: { user: { select: { id: true, name: true, role: true } } } }, pins: { where: { userId: authUser.userId } } },
      });
      return { success: true, thread: presentThread(thread, authUser.userId) };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const existing = await prisma.chatThread.findFirst({ where, include: { members: { include: { user: { select: { id: true, name: true, role: true } } } }, pins: { where: { userId: authUser.userId } } } });
      if (uniqueRoom && existing) return { success: true, thread: presentThread(existing, authUser.userId) };
      if (groupType === 'CUSTOM') return reply.status(409).send({ error: 'A group with that name already exists at your facility' });
      throw error;
    }
  });

  fastify.get('/chat/threads', { preHandler: [authenticate] }, async (request) => {
    const authUser = getAuthUser(request);
    if (worksAs(authUser, 'SUPER_ADMIN')) return { success: true, threads: [] };
    const { userId } = authUser;
    const roles = [...new Set([authUser.role, ...(authUser.extraRoles ?? [])])] as Role[];
    const threads = await prisma.chatThread.findMany({
      where: {
        clinicId: authUser.clinicId,
        OR: [
          { kind: 'STAFF_STAFF', OR: [{ userAId: userId }, { userBId: userId }] },
          { kind: 'STAFF_GROUP', groupType: 'FACILITY' },
          ...(roles.length ? [{ kind: 'STAFF_GROUP' as const, groupType: 'ROLE' as const, groupRole: { in: roles } }] : []),
          { kind: 'STAFF_GROUP', groupType: 'CUSTOM', members: { some: { userId } } },
          ...(worksAs(authUser, 'ADMIN') ? [{ kind: 'ADMIN_SUPER' as const }] : []),
        ],
      },
      include: {
        userA: { select: { id: true, name: true, role: true } },
        userB: { select: { id: true, name: true, role: true } },
        members: { include: { user: { select: { id: true, name: true, role: true } } } },
        pins: { where: { userId } },
        reads: { where: { userId }, select: { lastReadAt: true } },
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
    const dynamicMembers = await prisma.user.findMany({ where: { clinicId: authUser.clinicId, isActive: true, role: { not: 'SUPER_ADMIN' } }, select: { id: true, name: true, role: true, extraRoles: true } });
    const presentedThreads = await Promise.all(threads.map(async (thread) => {
      const members = thread.groupType === 'FACILITY'
        ? dynamicMembers
        : thread.groupType === 'ROLE'
          ? dynamicMembers.filter((member) => member.role === thread.groupRole || member.extraRoles.includes(thread.groupRole as Role))
          : undefined;
      const unreadCount = thread.kind === 'STAFF_GROUP'
        ? await prisma.chatMessage.count({
            where: {
              threadId: thread.id,
              authorUserId: { not: userId },
              ...(thread.reads[0] ? { createdAt: { gt: thread.reads[0].lastReadAt } } : { createdAt: { gte: thread.createdAt } }),
            },
          })
        : thread.kind === 'ADMIN_SUPER'
          ? await unreadSupportCount(thread.id, true, thread.reads[0]?.lastReadAt)
        : thread._count.messages;
      return { ...presentThread(thread, userId, members, unreadCount), memberCount: members?.length ?? thread.members?.length ?? 0 };
    }));
    return { success: true, threads: presentedThreads };
  });

  // ─── Staff: open or find a DM ──────────────────────────────────────────
  fastify.post('/chat/threads', { preHandler: [authenticate] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    if (worksAs(authUser, 'SUPER_ADMIN')) return reply.status(403).send({ error: 'Platform administrators use Bulamu Support' });
    const { toUserId } = request.body as any;
    if (!toUserId || typeof toUserId !== 'string') return reply.status(400).send({ error: 'toUserId is required' });
    if (toUserId === authUser.userId) return reply.status(400).send({ error: 'You cannot message yourself' });

    const toUser = await prisma.user.findUnique({ where: { id: toUserId }, select: { id: true, clinicId: true, isActive: true, name: true, role: true } });
    if (!toUser || toUser.clinicId !== authUser.clinicId || !toUser.isActive || toUser.role === 'SUPER_ADMIN') {
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
        pins: { where: { userId: authUser.userId } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { messages: { where: { authorUserId: { not: authUser.userId }, readAt: null } } } },
      },
    });
    return { success: true, thread: presentThread(thread, authUser.userId) };
  });

  // ─── Staff: messages in a DM/support thread ────────────────────────────
  fastify.get('/chat/threads/:id/messages', { preHandler: [authenticate] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as any;
    const { before, after } = request.query as any;

    const thread = await findStaffThread(id, authUser);
    if (!thread) return reply.status(404).send({ error: 'Thread not found' });
    const messages = await prisma.chatMessage.findMany({
      where: { threadId: id, ...(before ? { createdAt: { lt: new Date(before) } } : after ? { createdAt: { gte: new Date(after) } } : {}) },
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
    const thread = await findStaffThread(id, authUser);
    if (!thread) return reply.status(404).send({ error: 'Thread not found' });
    let body: string;
    let emailRequested: boolean;
    try { ({ body, emailRequested } = messageInput(request.body, thread.kind)); }
    catch (error: any) { return reply.status(400).send({ error: error.message }); }

    const [msg] = await prisma.$transaction([
      prisma.chatMessage.create({
        data: { threadId: id, authorUserId: authUser.userId, body },
        include: { authorUser: { select: { name: true } } },
      }),
      prisma.chatThread.update({ where: { id }, data: { updatedAt: new Date() } }),
    ]);
    const emailNotification = emailRequested ? await sendSupportEmail({ threadId: id, clinicId: authUser.clinicId, senderName: msg.authorUser?.name ?? 'A facility administrator', fromSuperAdmin: false }) : undefined;
    return { success: true, message: presentMessage(msg), ...(emailRequested ? { emailNotification } : {}) };
  });

  // ─── Staff: mark thread read ───────────────────────────────────────────
  fastify.post('/chat/threads/:id/read', { preHandler: [authenticate] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as any;
    const thread = await findStaffThread(id, authUser);
    if (!thread) return reply.status(404).send({ error: 'Thread not found' });
    if (thread.kind === 'STAFF_GROUP' || thread.kind === 'ADMIN_SUPER') {
      await saveThreadRead(id, authUser.userId);
    } else {
      await prisma.chatMessage.updateMany({
        where: { threadId: id, authorUserId: { not: authUser.userId }, readAt: null },
        data: { readAt: new Date() },
      });
    }
    return { success: true };
  });

  fastify.post('/chat/threads/:id/pin', { preHandler: [authenticate] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as any;
    const { pinned } = request.body as any;
    if (typeof pinned !== 'boolean') return reply.status(400).send({ error: 'pinned must be true or false' });
    if (!await findStaffThread(id, authUser)) return reply.status(404).send({ error: 'Thread not found' });
    if (pinned) await prisma.chatThreadPin.upsert({ where: { threadId_userId: { threadId: id, userId: authUser.userId } }, create: { threadId: id, userId: authUser.userId }, update: {} });
    else await prisma.chatThreadPin.deleteMany({ where: { threadId: id, userId: authUser.userId } });
    return { success: true, pinned };
  });

  // ─── Admin: open/find support thread with Bulamu ───────────────────────
  fastify.post('/chat/admin-support', { preHandler: [requireRole('ADMIN')] }, async (request) => {
    const authUser = getAuthUser(request);
    // The partial unique index guarantees one support room per facility even
    // when two admins open it at the same time.
    const existing = await prisma.chatThread.findFirst({
      where: { kind: 'ADMIN_SUPER', clinicId: authUser.clinicId },
      include: {
        userA: { select: { id: true, name: true, role: true } },
        pins: { where: { userId: authUser.userId } },
        reads: { where: { userId: authUser.userId }, select: { lastReadAt: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { messages: { where: { authorUser: { is: { role: 'SUPER_ADMIN' } }, readAt: null } } } },
      },
    });
    if (existing) return { success: true, thread: { ...presentThread(existing, authUser.userId), unreadCount: await unreadSupportCount(existing.id, true, existing.reads[0]?.lastReadAt) } };

    try {
      const thread = await prisma.chatThread.create({
        data: { clinicId: authUser.clinicId, kind: 'ADMIN_SUPER', userAId: authUser.userId },
        include: {
          userA: { select: { id: true, name: true, role: true } },
          pins: { where: { userId: authUser.userId } },
          reads: { where: { userId: authUser.userId }, select: { lastReadAt: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          _count: { select: { messages: { where: { authorUser: { is: { role: 'SUPER_ADMIN' } }, readAt: null } } } },
        },
      });
      return { success: true, thread: { ...presentThread(thread, authUser.userId), unreadCount: await unreadSupportCount(thread.id, true, thread.reads[0]?.lastReadAt) } };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const thread = await prisma.chatThread.findFirst({
        where: { kind: 'ADMIN_SUPER', clinicId: authUser.clinicId },
        include: {
          userA: { select: { id: true, name: true, role: true } },
          pins: { where: { userId: authUser.userId } },
          reads: { where: { userId: authUser.userId }, select: { lastReadAt: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          _count: { select: { messages: { where: { authorUser: { is: { role: 'SUPER_ADMIN' } }, readAt: null } } } },
        },
      });
      if (!thread) throw error;
      return { success: true, thread: { ...presentThread(thread, authUser.userId), unreadCount: await unreadSupportCount(thread.id, true, thread.reads[0]?.lastReadAt) } };
    }
  });

  // ─── Super-admin: support inbox ────────────────────────────────────────
  fastify.get('/chat/super-admin/threads', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request) => {
    const authUser = getAuthUser(request);
    const threads = await prisma.chatThread.findMany({
      where: { kind: 'ADMIN_SUPER' },
      include: {
        userA: { select: { id: true, name: true, role: true } },
        pins: { where: { userId: authUser.userId } },
        reads: { where: { userId: authUser.userId }, select: { lastReadAt: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
    });
    // Attach clinic name
    const clinicIds = [...new Set(threads.map((t) => t.clinicId).filter(Boolean) as string[])];
    const clinics = await prisma.clinic.findMany({ where: { id: { in: clinicIds } }, select: { id: true, name: true } });
    const clinicMap = Object.fromEntries(clinics.map((c) => [c.id, c.name]));
    return {
      success: true,
      threads: await Promise.all(threads.map(async (t) => ({
        ...presentThread(t, authUser.userId),
        unreadCount: await unreadSupportCount(t.id, false, t.reads[0]?.lastReadAt),
        clinicName: t.clinicId ? (clinicMap[t.clinicId] ?? null) : null,
      }))),
    };
  });

  fastify.get('/chat/super-admin/unread-count', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request) => {
    const authUser = getAuthUser(request);
    const threads = await prisma.chatThread.findMany({
      where: { kind: 'ADMIN_SUPER' },
      select: { id: true, reads: { where: { userId: authUser.userId }, select: { lastReadAt: true } } },
    });
    const count = (await Promise.all(threads.map((thread) => unreadSupportCount(thread.id, false, thread.reads[0]?.lastReadAt)))).reduce((sum, value) => sum + value, 0);
    return { success: true, count };
  });

  fastify.get('/chat/super-admin/threads/:id/messages', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
    const { id } = request.params as any;
    const { before, after } = request.query as any;
    const thread = await prisma.chatThread.findUnique({ where: { id }, select: { kind: true } });
    if (!thread || thread.kind !== 'ADMIN_SUPER') return reply.status(404).send({ error: 'Thread not found' });
    const messages = await prisma.chatMessage.findMany({
      where: { threadId: id, ...(before ? { createdAt: { lt: new Date(before) } } : after ? { createdAt: { gte: new Date(after) } } : {}) },
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
    let emailRequested: boolean;
    const thread = await prisma.chatThread.findUnique({ where: { id }, select: { kind: true, clinicId: true } });
    if (!thread || thread.kind !== 'ADMIN_SUPER') return reply.status(404).send({ error: 'Thread not found' });
    try { ({ body, emailRequested } = messageInput(request.body, thread.kind)); }
    catch (error: any) { return reply.status(400).send({ error: error.message }); }
    const [msg] = await prisma.$transaction([
      prisma.chatMessage.create({
        data: { threadId: id, authorUserId: authUser.userId, body },
        include: { authorUser: { select: { name: true } } },
      }),
      prisma.chatThread.update({ where: { id }, data: { updatedAt: new Date() } }),
    ]);
    const emailNotification = emailRequested ? await sendSupportEmail({ threadId: id, clinicId: thread.clinicId!, senderName: msg.authorUser?.name ?? 'Bulamu Support', fromSuperAdmin: true }) : undefined;
    return { success: true, message: presentMessage(msg), ...(emailRequested ? { emailNotification } : {}) };
  });
  fastify.post('/chat/super-admin/threads/:id/read', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
    const { id } = request.params as any;
    const thread = await prisma.chatThread.findUnique({ where: { id }, select: { kind: true } });
    if (!thread || thread.kind !== 'ADMIN_SUPER') return reply.status(404).send({ error: 'Thread not found' });
    const authUser = getAuthUser(request);
    await saveThreadRead(id, authUser.userId);
    return { success: true };
  });

  fastify.post('/chat/super-admin/threads/:id/pin', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as any;
    const { pinned } = request.body as any;
    if (typeof pinned !== 'boolean') return reply.status(400).send({ error: 'pinned must be true or false' });
    const thread = await prisma.chatThread.findFirst({ where: { id, kind: 'ADMIN_SUPER' }, select: { id: true } });
    if (!thread) return reply.status(404).send({ error: 'Thread not found' });
    if (pinned) await prisma.chatThreadPin.upsert({ where: { threadId_userId: { threadId: id, userId: authUser.userId } }, create: { threadId: id, userId: authUser.userId }, update: {} });
    else await prisma.chatThreadPin.deleteMany({ where: { threadId: id, userId: authUser.userId } });
    return { success: true, pinned };
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
    const { before, after } = request.query as any;
    const thread = await findPatientChatThread(id, patientAccountId);
    if (!thread) return reply.status(404).send({ error: 'Thread not found' });
    const messages = await prisma.chatMessage.findMany({ where: { threadId: id, ...(before ? { createdAt: { lt: new Date(before) } } : after ? { createdAt: { gte: new Date(after) } } : {}) }, orderBy: { createdAt: 'desc' }, take: PAGE_SIZE, include: { authorUser: { select: { name: true } } } });
    return { success: true, messages: messages.map(presentMessage) };
  });

  fastify.post('/patient-portal/chat/threads/:id/messages', { preHandler: [authenticatePatient] }, async (request, reply) => {
    const { patientAccountId } = getPatientAuthUser(request);
    const { id } = request.params as any;
    let body: string;
    try { rejectAttachments(request.body); body = sanitizeBody((request.body as any)?.body); } catch (error: any) { return reply.status(400).send({ error: error.message }); }
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
    try { rejectAttachments(request.body); body = sanitizeBody((request.body as any)?.body); } catch (error: any) { return reply.status(400).send({ error: error.message }); }
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
