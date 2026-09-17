import { FastifyRequest, FastifyReply } from 'fastify';
import { getSubscriptionGate } from '../lib/subscription';
import { prisma } from '../lib/prisma';

/**
 * Verifies the JWT and re-checks the account/facility is still active.
 * Shared by authenticate() and requireRole() so this check applies no
 * matter which one gates a given route - it used to live only in
 * authenticate(), which meant any route gated by requireRole() alone (most
 * SUPER_ADMIN-only routes, staff-creation routes, etc.) never got the
 * suspend/deactivate-takes-effect-immediately protection. Sends the error
 * response itself and returns false on failure so callers can just return.
 */
export async function verifyStaffSession(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.status(401).send({ error: 'Unauthorized' });
    return false;
  }

  // A patient-portal token is signed with the same JWT_SECRET but carries no
  // userId/role a staff route can act on - reject it explicitly rather than
  // letting it fall through into a DB lookup with an undefined id.
  if ((request.user as { kind?: string }).kind === 'patient') {
    reply.status(401).send({ error: 'Unauthorized' });
    return false;
  }

  // A JWT stays cryptographically valid until it naturally expires, so a
  // deactivated user or a suspended/deleted facility would otherwise keep
  // working for the rest of that token's lifetime. Re-check current status
  // on every request so suspend/deactivate/delete take effect immediately
  // rather than "eventually, once the old token expires".
  const authUser = request.user as AuthUser;
  const user = await prisma.user.findUnique({
    where: { id: authUser.userId },
    select: { isActive: true, clinic: { select: { isActive: true, registrationStatus: true, deletedAt: true } } },
  });
  if (!user || !user.isActive || !user.clinic || user.clinic.deletedAt) {
    reply.status(401).send({ error: 'Account no longer active' });
    return false;
  }
  if (authUser.role !== 'SUPER_ADMIN' && (!user.clinic.isActive || user.clinic.registrationStatus !== 'APPROVED')) {
    reply.status(401).send({ error: 'Facility account is not active' });
    return false;
  }

  return true;
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const ok = await verifyStaffSession(request, reply);
  if (!ok) return;
  await enforceSubscriptionGate(request, reply);
}

export type AuthUser = {
  userId: string;
  clinicId: string;
  role: string;
};

export function getAuthUser(request: FastifyRequest): AuthUser {
  return request.user as AuthUser;
}

/**
 * Blocks writes from a clinic whose trial has lapsed or whose subscription is
 * past due - reads always pass so a lapsed subscription never locks a
 * clinician out of viewing existing patient records, only new writes.
 * SUPER_ADMIN and the billing routes themselves (an ADMIN must be able to pay
 * their way out of this state) are always exempt.
 */
export async function enforceSubscriptionGate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authUser = getAuthUser(request);
  if (!authUser) return;
  if (authUser.role === 'SUPER_ADMIN') return;
  if (request.method === 'GET') return;
  if (request.url.startsWith('/billing')) return;

  const { blocked } = await getSubscriptionGate(authUser.clinicId);
  if (blocked) {
    reply.status(402).send({ error: 'Your facility subscription is past due', reason: 'SUBSCRIPTION_REQUIRED' });
  }
}

/**
 * Resolves the clinicId a request is allowed to operate on.
 * SUPER_ADMIN may target any clinic (oversight). Every other role is locked
 * to their own clinicId from the JWT - a mismatched request is rejected
 * rather than silently redirected, so client bugs surface instead of leaking data.
 * Returns null (and sends the 403) when access is denied.
 */
export function resolveClinicScope(
  request: FastifyRequest,
  reply: FastifyReply,
  requestedClinicId?: string | null
): string | null {
  const authUser = getAuthUser(request);

  if (authUser.role === 'SUPER_ADMIN') {
    return requestedClinicId || authUser.clinicId;
  }

  if (requestedClinicId && requestedClinicId !== authUser.clinicId) {
    reply.status(403).send({ error: 'Access denied: you do not have access to this facility' });
    return null;
  }

  return authUser.clinicId;
}

/**
 * Validates that an already-fetched record belongs to the caller's clinic.
 * Use for update/delete routes keyed by record id rather than clinicId.
 */
export function assertClinicMatch(
  request: FastifyRequest,
  reply: FastifyReply,
  recordClinicId: string | null | undefined
): boolean {
  const authUser = getAuthUser(request);

  if (authUser.role === 'SUPER_ADMIN') return true;

  if (!recordClinicId || recordClinicId !== authUser.clinicId) {
    reply.status(403).send({ error: 'Access denied: you do not have access to this record' });
    return false;
  }

  return true;
}
