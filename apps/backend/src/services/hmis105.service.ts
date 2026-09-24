import { prisma } from '../lib/prisma';
import { getHmisAgeCohort, HMIS_AGE_COHORTS } from '../lib/age';
import { HMIS_SERVICE_TAGS } from '../lib/hmis';
import { classifyHmisCondition } from '../lib/clinical';

/**
 * Computes the HMIS 105 Health Unit Outpatient Monthly Report for a clinic.
 * Shared by the report-viewing endpoint and the DHIS2 push endpoint so the
 * two never drift out of sync with each other.
 */
export async function computeHmis105Report(clinicId: string, month: number, year: number) {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59);

  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId } });
  const consultations = await prisma.consultation.findMany({
    where: {
      createdAt: { gte: startDate, lte: endDate },
      deletedAt: null,
      patient: { clinicId },
    },
    include: { patient: true, prescriptions: true, labTests: true, diagnoses: true },
  });

  const medicines = await prisma.medicine.findMany({ where: { clinicId, deletedAt: null } });

  const reproductiveHealthRecords = await prisma.reproductiveHealthRecord.findMany({
    where: {
      createdAt: { gte: startDate, lte: endDate },
      deletedAt: null,
      patient: { clinicId },
    },
  });

  const referralsOut = await prisma.referral.findMany({
    where: { fromClinicId: clinicId, createdAt: { gte: startDate, lte: endDate } },
    include: { toClinic: { select: { name: true } } },
  });

  let malariaCases = 0;
  let feverCases = 0;
  let dysenteryCases = 0;
  let measlesCases = 0;
  let meningitisCases = 0;
  let respiratoryCases = 0;
  let otherCases = 0;

  // Each visit is counted once, under its PRIMARY diagnosis. The ICD-10 code
  // decides the line when there is one (and a suspected malaria is reported as
  // unconfirmed, not confirmed); visits recorded before coding fall back to the
  // diagnosis text.
  consultations.forEach((c) => {
    const primary = c.diagnoses.find((d) => d.type === 'PRIMARY') ?? c.diagnoses[0];
    const condition = classifyHmisCondition(primary ?? { description: c.diagnosis });
    if (condition === 'malaria') malariaCases++;
    else if (condition === 'fever') feverCases++;
    else if (condition === 'dysentery') dysenteryCases++;
    else if (condition === 'measles') measlesCases++;
    else if (condition === 'meningitis') meningitisCases++;
    else if (condition === 'respiratory') respiratoryCases++;
    else otherCases++;
  });

  const lowStockMedicines = medicines.filter((m) => m.quantity <= m.reorderLevel);

  const familyPlanningCounts: Record<string, number> = {};
  for (const record of reproductiveHealthRecords) {
    familyPlanningCounts[record.familyPlanningMethod] = (familyPlanningCounts[record.familyPlanningMethod] || 0) + 1;
  }

  const attendanceByCohort: Record<string, { male: number; female: number; other: number }> = {};
  for (const cohort of HMIS_AGE_COHORTS) {
    attendanceByCohort[cohort] = { male: 0, female: 0, other: 0 };
  }
  for (const c of consultations) {
    if (!c.patient.dateOfBirth) continue;
    const cohort = getHmisAgeCohort(c.patient.dateOfBirth, endDate);
    const bucket = attendanceByCohort[cohort];
    if (c.patient.sex === 'MALE') bucket.male++;
    else if (c.patient.sex === 'FEMALE') bucket.female++;
    else bucket.other++;
  }

  const serviceTagCounts: Record<string, number> = {};
  for (const tag of HMIS_SERVICE_TAGS) serviceTagCounts[tag] = 0;
  for (const c of consultations) {
    for (const tag of c.serviceTags) {
      if (tag in serviceTagCounts) serviceTagCounts[tag]++;
    }
  }

  const pregnantCount = reproductiveHealthRecords.filter((r) => r.pregnancyStatus === 'PREGNANT').length;
  const postpartumCount = reproductiveHealthRecords.filter((r) => r.pregnancyStatus === 'POSTPARTUM').length;

  return {
    reportTitle: 'HMIS 105: Health Unit Outpatient Monthly Report',
    facilityName: clinic?.name || 'Uganda Rural Health Centre',
    period: `${month}/${year}`,
    section1_attendance: {
      totalOutpatients: consultations.length,
      newAttenders: consultations.length, // Simplified
      reAttenders: 0,
      byAgeCohortAndGender: attendanceByCohort,
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
    section4_familyPlanning: {
      totalRecorded: reproductiveHealthRecords.length,
      byMethod: familyPlanningCounts,
    },
    section5_maternalHealth: {
      pregnantClients: pregnantCount,
      postpartumClients: postpartumCount,
    },
    section6_services: {
      byTag: serviceTagCounts,
    },
    section7_referrals: {
      totalReferred: referralsOut.length,
      referrals: referralsOut.map((r) => ({ toFacility: r.toClinic.name, reason: r.reason, status: r.status })),
    },
  };
}
