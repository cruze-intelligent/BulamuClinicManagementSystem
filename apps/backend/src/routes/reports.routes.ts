import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireRole } from '../middleware/rbac.middleware';

export async function reportsRoutes(fastify: FastifyInstance) {
  
  // Standard Monthly report
  fastify.get('/reports/monthly/:clinicId', { preHandler: [requireRole('ADMIN', 'DOCTOR')] }, async (request, reply) => {
    const { clinicId } = request.params as any;
    const { month = new Date().getMonth() + 1, year = new Date().getFullYear() } = request.query as any;

    try {
      const startDate = new Date(Number(year), Number(month) - 1, 1);
      const endDate = new Date(Number(year), Number(month), 0, 23, 59, 59);

      const [totalPatients, totalAppointments, totalConsultations, revenue, topDiagnoses] = await Promise.all([
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
        prisma.consultation.groupBy({
          by: ['diagnosis'],
          where: {
            createdAt: { gte: startDate, lte: endDate },
            appointment: { clinicId }
          },
          _count: { diagnosis: true },
          orderBy: { _count: { diagnosis: 'desc' } },
          take: 5
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
          topDiagnoses
        }
      };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // Ministry of Health Uganda HMIS 105 Outpatient Monthly Report
  fastify.get('/reports/hmis-105/:clinicId', { preHandler: [requireRole('ADMIN', 'DOCTOR', 'NURSE', 'STAFF')] }, async (request, reply) => {
    const { clinicId } = request.params as any;
    const { month = new Date().getMonth() + 1, year = new Date().getFullYear() } = request.query as any;

    try {
      const startDate = new Date(Number(year), Number(month) - 1, 1);
      const endDate = new Date(Number(year), Number(month), 0, 23, 59, 59);

      const clinic = await prisma.clinic.findUnique({ where: { id: clinicId } });
      const consultations = await prisma.consultation.findMany({
        where: {
          createdAt: { gte: startDate, lte: endDate },
          patient: { clinicId },
        },
        include: { patient: true, prescriptions: true, labTests: true },
      });

      const medicines = await prisma.medicine.findMany({ where: { clinicId } });

      let malariaCases = 0;
      let feverCases = 0;
      let dysenteryCases = 0;
      let measlesCases = 0;
      let meningitisCases = 0;
      let respiratoryCases = 0;
      let otherCases = 0;

      consultations.forEach((c) => {
        const diag = c.diagnosis.toLowerCase();
        if (diag.includes('malaria')) malariaCases++;
        else if (diag.includes('fever') || diag.includes('pyrexia')) feverCases++;
        else if (diag.includes('dysentery') || diag.includes('diarrhea') || diag.includes('diarrhoea')) dysenteryCases++;
        else if (diag.includes('measles')) measlesCases++;
        else if (diag.includes('meningitis')) meningitisCases++;
        else if (diag.includes('respiratory') || diag.includes('cough') || diag.includes('pneumonia')) respiratoryCases++;
        else otherCases++;
      });

      const lowStockMedicines = medicines.filter((m) => m.quantity <= m.reorderLevel);

      return {
        success: true,
        reportTitle: 'HMIS 105: Health Unit Outpatient Monthly Report',
        facilityName: clinic?.name || 'Uganda Rural Health Centre',
        period: `${month}/${year}`,
        section1_attendance: {
          totalOutpatients: consultations.length,
          newAttenders: consultations.length, // Simplified
          reAttenders: 0,
        },
        section2_epidemicSurveillance: [
          { condition: 'Suspected Fever / Unconfirmed Malaria', cases: feverCases },
          { condition: 'Confirmed Malaria', cases: malariaCases },
          { condition: 'Dysentery / Acute Diarrhea', cases: dysenteryCases },
          { condition: 'Measles', cases: measlesCases },
          { condition: 'Bacterial Meningitis', cases: meningitisCases },
          { condition: 'Severe Acute Respiratory Infections (SARI)', cases: respiratoryCases },
          { condition: 'Other General Conditions', cases: otherCases },
        ],
        section3_essentialMedicines: {
          totalTracked: medicines.length,
          stockOutAlerts: lowStockMedicines.length,
          lowStockList: lowStockMedicines.map((m) => ({
            name: m.name,
            currentQuantity: m.quantity,
            reorderLevel: m.reorderLevel,
          })),
        },
      };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // HL7 FHIR R4 JSON Export for interoperability (DHIS2, UgandaEMR, OpenHIM)
  fastify.get('/reports/fhir/patients/:clinicId', { preHandler: [requireRole('ADMIN', 'DOCTOR', 'NURSE', 'STAFF')] }, async (request, reply) => {
    const { clinicId } = request.params as any;

    try {
      const patients = await prisma.patient.findMany({
        where: { clinicId },
        include: { consultations: true, labTests: true },
      });

      const fhirBundle = {
        resourceType: 'Bundle',
        type: 'collection',
        timestamp: new Date().toISOString(),
        total: patients.length,
        entry: patients.map((patient) => ({
          fullUrl: `urn:uuid:${patient.id}`,
          resource: {
            resourceType: 'Patient',
            id: patient.id,
            active: true,
            name: [
              {
                use: 'official',
                text: patient.name,
              },
            ],
            telecom: [
              {
                system: 'phone',
                value: patient.phone,
              },
            ],
            meta: {
              lastUpdated: patient.updatedAt.toISOString(),
            },
          },
        })),
      };

      reply.header('Content-Disposition', `attachment; filename="fhir-patients-${clinicId}.json"`);
      return fhirBundle;
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });
}