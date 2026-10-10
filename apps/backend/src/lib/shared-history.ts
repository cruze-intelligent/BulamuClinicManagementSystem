import { prisma } from './prisma';
import { formatPrescriptionLine } from './clinical';
import { allergyText } from './patient-text';

/**
 * A patient's history from OTHER facilities, as shown to clinicians at a
 * facility the patient has approved (see HistoryShare). What is shared is what
 * the next clinician needs to treat safely - allergies, diagnoses, medicines,
 * lab results and hospital stays - and nothing more:
 *
 *  - never reproductive-health records, documents, billing, or the clinicians'
 *    free-text assessment notes;
 *  - only facilities the patient currently has a relationship with (the one
 *    that created their account, or one they approved and haven't revoked) -
 *    the same rule as the patient's own Patient Portal view.
 */

/** Facilities whose records belong to this patient's account and are currently authorised. */
export async function authorisedClinicIds(patientAccountId: string): Promise<Set<string>> {
  const [account, grants] = await Promise.all([
    prisma.patientAccount.findUnique({ where: { id: patientAccountId }, select: { createdByClinicId: true } }),
    prisma.patientAccessGrant.findMany({ where: { patientAccountId, revokedAt: null }, select: { clinicId: true } }),
  ]);
  return new Set([...(account ? [account.createdByClinicId] : []), ...grants.map((g) => g.clinicId)]);
}

/** The approved share that lets `clinicId` read this account's history, if there is one and it is still valid. */
export async function activeShare(patientAccountId: string, clinicId: string) {
  const share = await prisma.historyShare.findFirst({ where: { patientAccountId, clinicId, status: 'APPROVED' }, orderBy: { approvedAt: 'desc' } });
  if (!share) return null;
  // A facility the patient has since cut off cannot keep reading.
  return (await authorisedClinicIds(patientAccountId)).has(clinicId) ? share : null;
}

export async function buildSharedHistory(patientAccountId: string, readingClinicId: string) {
  const allowed = await authorisedClinicIds(patientAccountId);
  allowed.delete(readingClinicId); // only OTHER facilities - the reader already has its own records

  const records = await prisma.patient.findMany({
    where: { patientAccountId, deletedAt: null, clinicId: { in: [...allowed] } },
    select: {
      allergyStatus: true, allergies: true,
      clinic: { select: { id: true, name: true, facilityType: true, district: true } },
      consultations: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          createdAt: true, symptoms: true,
          diagnoses: { orderBy: [{ type: 'asc' }, { createdAt: 'asc' }], select: { description: true, icd10Code: true, type: true, certainty: true } },
          prescriptions: {
            orderBy: { createdAt: 'asc' },
            select: { medication: true, strength: true, form: true, dosage: true, route: true, frequency: true, duration: true, quantity: true, instructions: true, dispensedAt: true },
          },
          appointment: { select: { doctor: { select: { name: true } } } },
        },
      },
      labTests: {
        where: { deletedAt: null, status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
        take: 50,
        select: { testName: true, results: true, completedAt: true, createdAt: true },
      },
      admissions: {
        orderBy: { admittedAt: 'desc' },
        take: 20,
        select: {
          admittedAt: true, dischargedAt: true, status: true, reason: true, outcome: true,
          dischargeDiagnosis: true, dischargeIcd10Code: true, dischargeSummary: true, followUpInstructions: true,
          ward: { select: { name: true, type: true } },
        },
      },
    },
  });

  return records.map((r) => ({
    facility: { name: r.clinic.name, type: r.clinic.facilityType, district: r.clinic.district },
    allergies: allergyText(r),
    visits: r.consultations.map((c) => ({
      date: c.createdAt,
      clinician: c.appointment?.doctor?.name ?? null,
      complaints: c.symptoms,
      diagnoses: c.diagnoses,
      medicines: c.prescriptions.map((rx) => {
        const line = formatPrescriptionLine(rx);
        return { title: line.title, directions: line.sig, dispensed: !!rx.dispensedAt };
      }),
    })),
    labResults: r.labTests.map((t) => ({ test: t.testName, result: t.results, date: t.completedAt ?? t.createdAt })),
    stays: r.admissions.map((a) => ({
      admittedAt: a.admittedAt, dischargedAt: a.dischargedAt, stillAdmitted: a.status === 'ADMITTED',
      ward: a.ward.name, reason: a.reason, outcome: a.outcome,
      finalDiagnosis: [a.dischargeDiagnosis, a.dischargeIcd10Code ? `(${a.dischargeIcd10Code})` : null].filter(Boolean).join(' ') || null,
      summary: a.dischargeSummary, followUp: a.followUpInstructions,
    })),
  }));
}
