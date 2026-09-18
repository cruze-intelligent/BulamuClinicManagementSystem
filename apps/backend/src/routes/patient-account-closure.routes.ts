import { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma';
import { authenticatePatient, getPatientAuthUser } from '../middleware/patient-auth.middleware';
import { closePatientAccount } from '../lib/patient-account-closure';

// Closing is irreversible, so it needs the password again (a stolen or left-open
// session alone must not be able to do it) and is rate limited against guessing.
const CLOSE_RATE_LIMIT = { max: 5, timeWindow: '15 minutes' };

export async function patientAccountClosureRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/patient-portal/account/close',
    { preHandler: [authenticatePatient], config: { rateLimit: CLOSE_RATE_LIMIT } },
    async (request, reply) => {
      const { password } = request.body as any;
      const { patientAccountId } = getPatientAuthUser(request);

      if (!password || typeof password !== 'string') {
        return reply.status(400).send({ error: 'Your password is required to close the account' });
      }

      const account = await prisma.patientAccount.findUnique({ where: { id: patientAccountId }, select: { password: true } });
      if (!account) return reply.status(404).send({ error: 'Account not found' });
      if (!(await bcrypt.compare(password, account.password))) {
        return reply.status(401).send({ error: 'Incorrect password' });
      }

      try {
        await closePatientAccount(patientAccountId, (message) => fastify.log.warn(message));
        return { success: true };
      } catch (error: any) {
        fastify.log.error(error, 'Patient account closure failed');
        return reply.status(500).send({ error: 'The account could not be closed. Nothing was changed - please try again.' });
      }
    }
  );
}
