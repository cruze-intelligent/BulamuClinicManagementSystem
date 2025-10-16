import { FastifyRequest, FastifyReply } from 'fastify';

export function requireRole(...allowedRoles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const user = request.user as any;

      if (!allowedRoles.includes(user.role)) {
        return reply.status(403).send({ error: 'Access denied: insufficient permissions' });
      }
    } catch (err) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  };
}