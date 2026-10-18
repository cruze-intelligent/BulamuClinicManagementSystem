import type { FastifyReply } from 'fastify';

/** An error that carries the HTTP status a route should answer with. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const SERVER_ERROR_MESSAGE =
  "Something went wrong on Bulamu's side. Please try again in a moment - if it keeps happening, contact Bulamu support.";
const NOT_SAVED_MESSAGE = 'That could not be saved. Please check the details and try again.';

/**
 * A technical failure - a database message, a programming slip - rather than a
 * message a route raised on purpose for the person to read.
 */
function isTechnical(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  if (error.name.startsWith('PrismaClient') || 'clientVersion' in error) return true;
  return error instanceof TypeError || error instanceof ReferenceError || error instanceof SyntaxError || error instanceof RangeError;
}

/**
 * Answers a route's catch-all with words a person can act on. A message the
 * route raised on purpose goes through as it is; anything technical is logged
 * for us and replaced, so database or code details never reach the screen.
 * A 500 is always replaced: it is never something the person can fix.
 */
export function sendRouteError(reply: FastifyReply, error: unknown, status = 500) {
  if (error instanceof HttpError) return reply.status(error.status).send({ error: error.message });
  if (status >= 500 || isTechnical(error)) {
    reply.log.error({ err: error }, 'Request failed');
    return reply.status(status).send({ error: status >= 500 ? SERVER_ERROR_MESSAGE : NOT_SAVED_MESSAGE });
  }
  return reply.status(status).send({ error: (error as Error).message });
}
