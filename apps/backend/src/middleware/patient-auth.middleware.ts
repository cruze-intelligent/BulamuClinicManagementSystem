import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';

export type PatientAuthUser = {
  kind: 'patient';
  patientAccountId: string;
};

export function getPatientAuthUser(request: FastifyRequest): PatientAuthUser {
  return request.user as PatientAuthUser;
}

// Parallel to authenticate() in auth.middleware.ts rather than a branch
// inside it - a patient principal has no userId/clinicId/Role, and staff
// authenticate() hard-assumes all three. Keeping the two middlewares
// separate means a bug in one can never silently grant staff-shaped access
// to a patient token or vice versa.
export async function authenticatePatient(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  const claims = request.user as Partial<PatientAuthUser>;
  if (claims.kind !== 'patient' || !claims.patientAccountId) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  // Re-checked on every request, same reasoning as the staff middleware: a
  // suspended account's already-issued token should stop working immediately,
  // not just once it naturally expires.
  const account = await prisma.patientAccount.findUnique({
    where: { id: claims.patientAccountId },
    select: { status: true },
  });
  if (!account || account.status !== 'ACTIVE') {
    return reply.status(401).send({ error: 'Account no longer active' });
  }
}
