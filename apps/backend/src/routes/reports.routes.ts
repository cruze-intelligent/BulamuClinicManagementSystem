import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireRole } from '../middleware/rbac.middleware';
import { resolveClinicScope, getAuthUser } from '../middleware/auth.middleware';
import { computeHmis105Report } from '../services/hmis105.service';
import { encryptSecret, decryptSecret } from '../lib/crypto';
import { buildDataValueSet, pushDataValueSet } from '../services/dhis2.service';
import { recordAudit } from '../lib/audit';
import { rankDiagnoses, formatPrescriptionLine } from '../lib/clinical';
import { sendRouteError } from '../lib/http-error';
import { eatDateKey, eatMonthRange } from '../lib/invoices';
import { sortDepartments } from '../lib/departments';
import { facilityLetterhead, generateTableReportPdf } from '../lib/pdf';
import { facilityLogo } from '../lib/facility-logo';
import { documentProducer } from '../lib/document-signer';
import { emailReportCopy } from '../lib/report-delivery';

/** This month in Kampala, for a report asked for without one. */
const thisMonth = () => { const day = eatDateKey(new Date()); return { month: Number(day.slice(5, 7)), year: Number(day.slice(0, 4)) }; };

/**
 * Appointments and patients seen in each unit, for a facility that has units:
 * every open unit (even a quiet one), any closed unit that still had visits,
 * and the visits given no unit.
 */
function visitsPerUnit(
  units: Array<{ id: string; code: string | null; name: string; isActive: boolean }>,
  appointments: Array<{ departmentId: string | null; _count: number }>,
  visits: Array<{ departmentId: string | null; _count: number }>,
) {
  if (units.length === 0) return [];
  const count = (rows: typeof visits, id: string | null) => rows.find((r) => r.departmentId === id)?._count ?? 0;
  const rows = sortDepartments(units)
    .map((u) => ({ name: u.name, appointments: count(appointments, u.id), visits: count(visits, u.id), isActive: u.isActive }))
    .filter((r) => r.isActive || r.appointments > 0 || r.visits > 0)
    .map(({ isActive: _, ...r }) => r);
  const none = { name: 'No unit given', appointments: count(appointments, null), visits: count(visits, null) };
  return none.appointments || none.visits ? [...rows, none] : rows;
}

/** The month's figures for a facility: patients, appointments, visits, money received, top diagnoses and visits per unit. */
export async function buildMonthlyReport(clinicId: string, month: number, year: number) {
  const range = eatMonthRange(`${year}-${String(month).padStart(2, '0')}`);
  const startDate = range.start;
  const endDate = new Date(range.end.getTime() - 1);

  const [totalPatients, totalAppointments, totalConsultations, revenue, primaryDiagnoses, units, appointmentsByUnit, visitsByUnit] = await Promise.all([
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
    // Money received in the month (payments that stand), whenever it was billed.
    prisma.patientPayment.aggregate({
      where: {
        clinicId,
        voidedAt: null,
        receivedAt: { gte: startDate, lte: endDate }
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
    }),
    prisma.department.findMany({ where: { clinicId }, select: { id: true, code: true, name: true, isActive: true } }),
    prisma.appointment.groupBy({
      by: ['departmentId'],
      where: { clinicId, deletedAt: null, date: { gte: startDate, lte: endDate } },
      _count: true,
    }),
    prisma.appointment.groupBy({
      by: ['departmentId'],
      where: { clinicId, deletedAt: null, consultation: { createdAt: { gte: startDate, lte: endDate }, deletedAt: null } },
      _count: true,
    }),
  ]);

  return {
    period: `${month}/${year}`,
    totalPatients,
    totalAppointments,
    totalConsultations,
    revenue: revenue._sum.amount || 0,
    topDiagnoses: rankDiagnoses(primaryDiagnoses),
    byUnit: visitsPerUnit(units, appointmentsByUnit, visitsByUnit),
  };
}

export async function reportsRoutes(fastify: FastifyInstance) {

  // Standard Monthly report
  fastify.get('/reports/monthly/:clinicId', { preHandler: [requireRole('ADMIN', 'DOCTOR')] }, async (request, reply) => {
    const { clinicId: requestedClinicId } = request.params as any;
    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;
    const { month = thisMonth().month, year = thisMonth().year } = request.query as any;

    try {
      return { success: true, report: await buildMonthlyReport(clinicId, Number(month), Number(year)) };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // The monthly report as a PDF under the facility's letterhead - downloaded,
  // and a copy emailed to whoever generated it (?email=0 to skip the email).
  fastify.get('/reports/monthly/:clinicId/pdf', { preHandler: [requireRole('ADMIN', 'DOCTOR')] }, async (request, reply) => {
    const clinicId = resolveClinicScope(request, reply, (request.params as { clinicId: string }).clinicId);
    if (!clinicId) return;
    const query = request.query as { month?: string; year?: string; email?: string };
    const month = Number(query.month ?? thisMonth().month);
    const year = Number(query.year ?? thisMonth().year);
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2100) {
      return reply.status(400).send({ error: 'Choose a month and year' });
    }
    try {
      const authUser = getAuthUser(request);
      const [report, clinic] = await Promise.all([
        buildMonthlyReport(clinicId, month, year),
        prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { name: true, facilityCode: true, phone: true, motto: true } }),
      ]);
      const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      const filename = `monthly-report-${year}-${String(month).padStart(2, '0')}.pdf`;
      const ugx = (n: number) => `UGX ${Math.round(n).toLocaleString('en-US')}`;
      const pdf = await generateTableReportPdf({
        letterhead: facilityLetterhead({ name: clinic.name, facilityCode: clinic.facilityCode, phone: clinic.phone, motto: clinic.motto, logo: await facilityLogo(clinicId) }),
        title: 'MONTHLY REPORT',
        subtitle: monthName,
        facts: [
          ['New patients registered', String(report.totalPatients)],
          ['Appointments booked', String(report.totalAppointments)],
          ['Consultations (patients seen)', String(report.totalConsultations)],
          ['Money received', ugx(report.revenue)],
        ],
        tables: [
          {
            title: 'Most common diagnoses',
            note: 'Primary diagnoses of the month\'s visits, counted by ICD-10 code.',
            columns: [{ header: 'Diagnosis', width: 330 }, { header: 'ICD-10', width: 80 }, { header: 'Visits', width: 85, align: 'right' }],
            rows: report.topDiagnoses.map((d) => [d.diagnosis, d.icd10Code ?? '-', String(d._count.diagnosis)]),
          },
          ...(report.byUnit.length ? [{
            title: 'Visits by unit',
            columns: [{ header: 'Unit', width: 295 }, { header: 'Booked', width: 100, align: 'right' as const }, { header: 'Seen', width: 100, align: 'right' as const }],
            rows: report.byUnit.map((u) => [u.name, String(u.appointments), String(u.visits)]),
          }] : []),
        ],
        producedBy: await documentProducer(authUser.userId),
      });
      await recordAudit({ entity: 'MonthlyReport', recordId: clinicId, clinicId, action: 'VIEW', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { month, year, format: 'pdf' } });
      if (query.email !== '0') {
        await emailReportCopy(reply, authUser.userId, { title: `Monthly report - ${clinic.name}, ${monthName}`, filename, content: pdf, contentType: 'application/pdf', facts: [['Facility', clinic.name], ['Month', monthName]] }, (m) => request.log.warn(m));
      }
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(pdf);
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // Ministry of Health Uganda HMIS 105 Outpatient Monthly Report
  fastify.get('/reports/hmis-105/:clinicId', { preHandler: [requireRole('ADMIN', 'DOCTOR', 'NURSE', 'STAFF')] }, async (request, reply) => {
    const { clinicId: requestedClinicId } = request.params as any;
    const clinicId = resolveClinicScope(request, reply, requestedClinicId);
    if (!clinicId) return;
    const { month = thisMonth().month, year = thisMonth().year } = request.query as any;

    try {
      const report = await computeHmis105Report(clinicId, Number(month), Number(year));
      return { success: true, ...report };
    } catch (error: any) {
      return sendRouteError(reply, error);
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
      return sendRouteError(reply, error, 400);
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
      return sendRouteError(reply, error);
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
    const { month = thisMonth().month, year = thisMonth().year } = request.query as any;

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
      return sendRouteError(reply, error);
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

        // Recorded allergies. "None known" is a fact worth exporting too, so it is
        // sent as the standard "no known allergy" coding rather than left out.
        if (patient.allergyStatus === 'KNOWN' && Array.isArray(patient.allergies)) {
          (patient.allergies as Array<{ substance: string; reaction?: string | null; severity?: string | null }>).forEach((a, i) => {
            entries.push({
              fullUrl: `urn:uuid:${patient.id}-allergy-${i}`,
              resource: {
                resourceType: 'AllergyIntolerance',
                id: `${patient.id}-allergy-${i}`,
                clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'active' }] },
                code: { text: a.substance },
                patient: { reference: `urn:uuid:${patient.id}` },
                ...(a.severity || a.reaction
                  ? { reaction: [{ manifestation: [{ text: a.reaction || 'Reaction not described' }], ...(a.severity ? { severity: a.severity.toLowerCase() } : {}) }] }
                  : {}),
              },
            });
          });
        } else if (patient.allergyStatus === 'NONE_KNOWN') {
          entries.push({
            fullUrl: `urn:uuid:${patient.id}-nka`,
            resource: {
              resourceType: 'AllergyIntolerance',
              id: `${patient.id}-nka`,
              clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'active' }] },
              code: { coding: [{ system: 'http://snomed.info/sct', code: '716186003', display: 'No known allergy' }] },
              patient: { reference: `urn:uuid:${patient.id}` },
            },
          });
        }

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
      return sendRouteError(reply, error);
    }
  });
}
