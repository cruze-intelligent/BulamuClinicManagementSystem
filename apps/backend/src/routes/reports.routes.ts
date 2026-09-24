import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireRole } from '../middleware/rbac.middleware';
import { resolveClinicScope, getAuthUser } from '../middleware/auth.middleware';
import { computeHmis105Report } from '../services/hmis105.service';
import { encryptSecret, decryptSecret } from '../lib/crypto';
import { buildDataValueSet, pushDataValueSet } from '../services/dhis2.service';
import { recordAudit } from '../lib/audit';
import { rankDiagnoses, formatPrescriptionLine } from '../lib/clinical';

export async function reportsRoutes(fastify: FastifyInstance) {

  // Standard Monthly report
  fastify.get('/reports/monthly/:clinicId', { preHandler: [requireRole('ADMIN', 'DOCTOR')] }, async (request, reply) => {
    const { clinicId: requestedClinicId } = request.params as any;
    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;
    const { month = new Date().getMonth() + 1, year = new Date().getFullYear() } = request.query as any;

    try {
      const startDate = new Date(Number(year), Number(month) - 1, 1);
      const endDate = new Date(Number(year), Number(month), 0, 23, 59, 59);

      const [totalPatients, totalAppointments, totalConsultations, revenue, primaryDiagnoses] = await Promise.all([
        prisma.patient.count({
          where: {
            clinicId,
            createdAt: { gte: startDate, lte: endDate }
          }
        }),
        prisma.appointment.count({
          where: {
            clinicId,
            date: { gte: startDate, lte: endDate }
          }
        }),
        prisma.consultation.count({
          where: {
            createdAt: { gte: startDate, lte: endDate },
            appointment: { clinicId }
          }
        }),
        prisma.invoice.aggregate({
          where: {
            clinicId,
            status: 'PAID',
            paidAt: { gte: startDate, lte: endDate }
          },
          _sum: { amount: true }
        }),
        // Primary diagnoses of the month's visits; ranked below by ICD-10 code
        // so "Malaria" and "malaria (RDT+)" count as one condition.
        prisma.diagnosis.findMany({
          where: {
            type: 'PRIMARY',
            consultation: { createdAt: { gte: startDate, lte: endDate }, deletedAt: null, appointment: { clinicId } }
          },
          select: { icd10Code: true, description: true }
        })
      ]);

      return {
        success: true,
        report: {
          period: `${month}/${year}`,
          totalPatients,
          totalAppointments,
          totalConsultations,
          revenue: revenue._sum.amount || 0,
          topDiagnoses: rankDiagnoses(primaryDiagnoses)
        }
      };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // Ministry of Health Uganda HMIS 105 Outpatient Monthly Report
  fastify.get('/reports/hmis-105/:clinicId', { preHandler: [requireRole('ADMIN', 'DOCTOR', 'NURSE', 'STAFF')] }, async (request, reply) => {
    const { clinicId: requestedClinicId } = request.params as any;
    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;
    const { month = new Date().getMonth() + 1, year = new Date().getFullYear() } = request.query as any;

    try {
      const report = await computeHmis105Report(clinicId, Number(month), Number(year));
      return { success: true, ...report };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // Configure a facility's DHIS2 integration (ADMIN/SUPER_ADMIN only).
  // Credentials are encrypted at rest and never echoed back in responses.
  fastify.put('/clinics/:clinicId/dhis2-integration', { preHandler: [requireRole('ADMIN', 'SUPER_ADMIN')] }, async (request, reply) => {
    const { clinicId: requestedClinicId } = request.params as any;
    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;
    const { baseUrl, username, password, orgUnitId, dataElementMap } = request.body as any;

    try {
      const integration = await prisma.dhis2Integration.upsert({
        where: { clinicId },
        update: {
          baseUrl, username, orgUnitId,
          dataElementMap: dataElementMap || {},
          ...(password ? { encryptedPassword: encryptSecret(password) } : {}),
        },
        create: {
          clinicId, baseUrl, username, orgUnitId,
          dataElementMap: dataElementMap || {},
          encryptedPassword: encryptSecret(password || ''),
        },
      });

      const { encryptedPassword, ...safeIntegration } = integration;
      return { success: true, integration: safeIntegration };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });

  fastify.get('/clinics/:clinicId/dhis2-integration', { preHandler: [requireRole('ADMIN', 'SUPER_ADMIN')] }, async (request, reply) => {
    const { clinicId: requestedClinicId } = request.params as any;
    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;

    try {
      const integration = await prisma.dhis2Integration.findUnique({ where: { clinicId } });
      if (!integration) return { success: true, integration: null };

      const { encryptedPassword, ...safeIntegration } = integration;
      return { success: true, integration: safeIntegration };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // Push the computed HMIS 105 figures to the facility's configured DHIS2
  // instance, per the research doc's "push completed datasets into DHIS2"
  // architecture. Dormant (400s with a clear message) until a facility has
  // configured real org-unit credentials via the route above.
  fastify.post('/reports/hmis-105/:clinicId/push-dhis2', { preHandler: [requireRole('ADMIN', 'SUPER_ADMIN')] }, async (request, reply) => {
    const { clinicId: requestedClinicId } = request.params as any;
    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;
    const { month = new Date().getMonth() + 1, year = new Date().getFullYear() } = request.query as any;

    try {
      const integration = await prisma.dhis2Integration.findUnique({ where: { clinicId } });
      if (!integration) {
        return reply.status(400).send({ error: 'DHIS2 integration is not configured for this facility yet' });
      }

      const report = await computeHmis105Report(clinicId, Number(month), Number(year));
      const period = `${year}${String(month).padStart(2, '0')}`;

      const { dataValueSet, unmappedFigures } = buildDataValueSet({
        report,
        dataElementMap: (integration.dataElementMap as Record<string, string>) || {},
        orgUnitId: integration.orgUnitId,
        period,
      });

      const result = await pushDataValueSet(dataValueSet, {
        baseUrl: integration.baseUrl,
        username: integration.username,
        password: decryptSecret(integration.encryptedPassword),
      });

      if (result.success) {
        await prisma.dhis2Integration.update({ where: { clinicId }, data: { lastPushedAt: new Date() } });
      }

      const authUser = getAuthUser(request);
      await recordAudit({
        entity: 'Dhis2Integration', recordId: integration.id, clinicId,
        action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role,
        metadata: { period, pushSuccess: result.success, unmappedFigures },
      });

      return { success: result.success, status: result.status, unmappedFigures, response: result.response };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // HL7 FHIR R4 JSON Export for interoperability (DHIS2, UgandaEMR, OpenHIM)
  fastify.get('/reports/fhir/patients/:clinicId', { preHandler: [requireRole('ADMIN', 'DOCTOR', 'NURSE', 'STAFF')] }, async (request, reply) => {
    const { clinicId: requestedClinicId } = request.params as any;
    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;

    try {
      const patients = await prisma.patient.findMany({
        where: { clinicId, deletedAt: null },
        include: {
          consultations: { where: { deletedAt: null }, include: { diagnoses: true, prescriptions: true } },
          labTests: true,
          reproductiveHealthRecords: { where: { deletedAt: null } },
        },
      });

      const entries: any[] = [];

      for (const patient of patients) {
        entries.push({
          fullUrl: `urn:uuid:${patient.id}`,
          resource: {
            resourceType: 'Patient',
            id: patient.id,
            active: true,
            gender: patient.sex ? patient.sex.toLowerCase() : undefined,
            birthDate: patient.dateOfBirth ? patient.dateOfBirth.toISOString().slice(0, 10) : undefined,
            name: [{ use: 'official', text: patient.name }],
            telecom: [{ system: 'phone', value: patient.phone }],
            meta: { lastUpdated: patient.updatedAt.toISOString() },
          },
        });

        for (const consultation of patient.consultations) {
          // ICD-10 is the coding system for diagnoses (an uncoded one is carried as text only).
          const diagnosisCoding = (d: { icd10Code: string | null; description: string }) => ({
            ...(d.icd10Code ? { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: d.icd10Code, display: d.description }] } : {}),
            text: d.description,
          });

          entries.push({
            fullUrl: `urn:uuid:${consultation.id}`,
            resource: {
              resourceType: 'Encounter',
              id: consultation.id,
              status: 'finished',
              subject: { reference: `urn:uuid:${patient.id}` },
              reasonCode: consultation.diagnoses.length > 0
                ? consultation.diagnoses.map(diagnosisCoding)
                : [{ text: consultation.diagnosis }],
              meta: { lastUpdated: consultation.updatedAt.toISOString() },
            },
          });

          for (const d of consultation.diagnoses) {
            entries.push({
              fullUrl: `urn:uuid:${d.id}`,
              resource: {
                resourceType: 'Condition',
                id: d.id,
                clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
                verificationStatus: {
                  coding: [{
                    system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
                    code: d.certainty === 'CONFIRMED' ? 'confirmed' : 'provisional',
                  }],
                },
                category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'encounter-diagnosis' }] }],
                code: diagnosisCoding(d),
                subject: { reference: `urn:uuid:${patient.id}` },
                encounter: { reference: `urn:uuid:${consultation.id}` },
                ...(d.notes ? { note: [{ text: d.notes }] } : {}),
              },
            });
          }

          for (const rx of consultation.prescriptions) {
            const line = formatPrescriptionLine(rx);
            entries.push({
              fullUrl: `urn:uuid:${rx.id}`,
              resource: {
                resourceType: 'MedicationRequest',
                id: rx.id,
                status: 'active',
                intent: 'order',
                medicationCodeableConcept: { text: line.title },
                subject: { reference: `urn:uuid:${patient.id}` },
                encounter: { reference: `urn:uuid:${consultation.id}` },
                authoredOn: rx.createdAt.toISOString(),
                dosageInstruction: [{
                  text: [line.sig, line.instructions].filter(Boolean).join('. '),
                  ...(rx.route ? { route: { text: rx.route } } : {}),
                }],
                ...(rx.quantity ? { dispenseRequest: { quantity: { value: rx.quantity } } } : {}),
              },
            });
          }
        }

        for (const rh of patient.reproductiveHealthRecords) {
          entries.push({
            fullUrl: `urn:uuid:${rh.id}`,
            resource: {
              resourceType: 'Observation',
              id: rh.id,
              status: 'final',
              subject: { reference: `urn:uuid:${patient.id}` },
              code: { coding: [{ system: 'http://loinc.org', code: '21840-4', display: 'Last menstrual period start date' }] },
              valueDateTime: rh.lastMenstrualPeriodDate ? rh.lastMenstrualPeriodDate.toISOString() : undefined,
              meta: { lastUpdated: rh.updatedAt.toISOString() },
            },
          });
        }
      }

      const fhirBundle = {
        resourceType: 'Bundle',
        type: 'collection',
        timestamp: new Date().toISOString(),
        total: entries.length,
        entry: entries,
      };

      reply.header('Content-Disposition', `attachment; filename="fhir-patients-${clinicId}.json"`);
      return fhirBundle;
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });
}
