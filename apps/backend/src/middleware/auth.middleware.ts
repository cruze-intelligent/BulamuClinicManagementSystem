import { FastifyRequest, FastifyReply } from 'fastify';

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.status(401).send({ error: 'Unauthorized' });
  }
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
