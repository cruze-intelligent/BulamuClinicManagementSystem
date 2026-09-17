import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { authenticatePatient, getPatientAuthUser } from '../middleware/patient-auth.middleware';

export async function patientPortalRoutes(fastify: FastifyInstance) {
  // The one deliberate, narrowly-scoped exception to "a facility never sees
  // another facility's data for a patient": this aggregates every Patient
  // row linked to the caller's own PatientAccount, across clinics, but only
  // inside the patient's own authenticated session (authenticatePatient) -
  // never exposed to any staff-facing route.
  fastify.get('/patient-portal/me', { preHandler: [authenticatePatient] }, async (request, reply) => {
    const authUser = getPatientAuthUser(request);

    try {
      const account = await prisma.patientAccount.findUnique({
        where: { id: authUser.patientAccountId },
        select: { portableId: true, email: true, phone: true, createdAt: true },
      });
      if (!account) return reply.status(404).send({ error: 'Account not found' });

      const records = await prisma.patient.findMany({
        where: { patientAccountId: authUser.patientAccountId, deletedAt: null },
        select: {
          id: true,
          name: true,
          sex: true,
          dateOfBirth: true,
          clinic: { select: { id: true, name: true, facilityType: true } },
          appointments: {
            where: { deletedAt: null },
            orderBy: { date: 'desc' },
            select: { id: true, date: true, time: true, status: true, notes: true, doctor: { select: { name: true } } },
          },
          consultations: {
            orderBy: { createdAt: 'desc' },
            select: {
              id: true, diagnosis: true, symptoms: true, createdAt: true,
              prescriptions: { select: { id: true, medication: true, dosage: true, frequency: true, duration: true } },
              invoice: { select: { id: true, amount: true, status: true, createdAt: true } },
            },
          },
          labTests: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { id: true, testName: true, results: true, status: true, createdAt: true },
          },
        },
      });

      return { success: true, account, records };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });
}
