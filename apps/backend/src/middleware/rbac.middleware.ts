import { FastifyRequest, FastifyReply } from 'fastify';
import { enforceSubscriptionGate, verifyStaffSession, worksAs, type AuthUser } from './auth.middleware';

export function requireRole(...allowedRoles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const ok = await verifyStaffSession(request, reply);
    if (!ok) return;

    // Their own role, or another role the administrator says they also work in.
    const user = request.user as AuthUser;
    if (!worksAs(user, ...allowedRoles)) {
      return reply.status(403).send({ error: 'Access denied: insufficient permissions' });
    }

    await enforceSubscriptionGate(request, reply);
  };
}