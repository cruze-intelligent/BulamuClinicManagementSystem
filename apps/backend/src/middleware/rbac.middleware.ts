import { FastifyRequest, FastifyReply } from 'fastify';
import { enforceSubscriptionGate, verifyStaffSession } from './auth.middleware';

export function requireRole(...allowedRoles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const ok = await verifyStaffSession(request, reply);
    if (!ok) return;

    const user = request.user as any;
    if (!allowedRoles.includes(user.role)) {
      return reply.status(403).send({ error: 'Access denied: insufficient permissions' });
    }

    await enforceSubscriptionGate(request, reply);
  };
}