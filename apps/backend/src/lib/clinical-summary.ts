import { prisma } from './prisma';
import { formatPrescriptionLine } from './clinical';
import { allergyText, patientIdText, sexAgeText } from './patient-text';
import { structuredNoteLines, structuredNoteTitle } from './procedure-notes';
import { vitalsLine } from './vitals';
import { imagingLine } from './imaging';

// One patient's record at this facility, the way a clinician reviews it:
// each visit with its complaints, history, vital signs, examination,
// diagnoses, lab results and treatment, then ward stays with the procedures
// and operations done, and lab results not tied to a visit. Newest first.

export type SummaryLab = { name: string; status: string; result: string | null; verified: boolean; at: Date };

export type ClinicalSummary = Awaited<ReturnType<typeof buildClinicalSummary>>;

const labView = (t: { testName: string; status: string; results: string; verifiedAt: Date | null; completedAt: Date | null; createdAt: Date }): SummaryLab => ({
  name: t.testName,
  status: t.status === 'COMPLETED' ? (t.verifiedAt ? 'Verified' : 'Awaiting verification') : t.status === 'CANCELLED' ? 'Cancelled' : 'Requested - no result yet',
  result: t.status === 'COMPLETED' ? t.results || null : null,
  verified: !!t.verifiedAt,
  at: t.completedAt ?? t.createdAt,
});

/** Everything the summary shows, for a patient of this facility; null if there is no such patient here. */
export async function buildClinicalSummary(patientId: string, clinicId: string) {
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId, deletedAt: null },
    select: {
      id: true, name: true, phone: true, sex: true, dateOfBirth: true, dateOfBirthEstimated: true, patientNumber: true,
      allergyStatus: true, allergies: true,
    },
  });
  if (!patient) return null;

  const [consultations, admissions, otherLabs, otherImaging] = await Promise.all([
    prisma.consultation.findMany({
      where: { patientId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        diagnoses: { orderBy: [{ type: 'asc' }, { createdAt: 'asc' }] },
        prescriptions: { orderBy: { createdAt: 'asc' } },
        procedures: { orderBy: { createdAt: 'asc' } },
        labTests: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        imagingRequests: { orderBy: { createdAt: 'asc' } },
        recordedBy: { select: { name: true } },
        appointment: { select: { doctor: { select: { name: true } } } },
      },
    }),
    prisma.admission.findMany({
      where: { patientId, clinicId },
      orderBy: { admittedAt: 'desc' },
      include: {
        ward: { select: { name: true } },
        notes: { where: { kind: { in: ['PROCEDURE', 'OPERATION_NOTE'] } }, orderBy: { createdAt: 'asc' }, select: { kind: true, details: true, createdAt: true } },
      },
    }),
    prisma.labTest.findMany({ where: { patientId, consultationId: null, deletedAt: null }, orderBy: { createdAt: 'desc' } }),
    prisma.imagingRequest.findMany({ where: { patientId, clinicId, consultationId: null }, orderBy: { createdAt: 'desc' } }),
  ]);

  return {
    patient: {
      name: patient.name,
      patientId: patientIdText(patient.patientNumber),
      sexAge: sexAgeText(patient),
      phone: patient.phone,
      allergies: allergyText(patient),
    },
    visits: consultations.map((c) => ({
      id: c.id,
      date: c.createdAt,
      clinician: (c.recordedBy ?? c.appointment.doctor)?.name ?? null,
      complaints: c.symptoms,
      history: c.history,
      vitals: vitalsLine(c.vitals),
      examination: c.examination,
      diagnoses: c.diagnoses.map((d) => `${d.description}${d.icd10Code ? ` (${d.icd10Code})` : ''}${d.certainty === 'PROVISIONAL' ? ' - suspected' : ''}${d.type === 'PRIMARY' ? '' : ' - secondary'}`),
      labs: c.labTests.map(labView),
      imaging: c.imagingRequests.map(imagingLine),
      treatment: c.prescriptions.map((rx) => {
        const line = formatPrescriptionLine(rx);
        return [line.order, line.instructions].filter(Boolean).join(' - ');
      }).concat(c.procedures.map((p) => `Procedure: ${p.name}${p.notes ? ` - ${p.notes}` : ''}`)),
      plan: c.clinicalNotes,
    })),
    stays: admissions.map((a) => ({
      id: a.id,
      ward: a.ward.name,
      admittedAt: a.admittedAt,
      dischargedAt: a.dischargedAt,
      reason: a.reason,
      dischargeDiagnosis: a.dischargeDiagnosis,
      dischargeSummary: a.dischargeSummary,
      procedures: a.notes.map((n) => ({ date: n.createdAt, title: structuredNoteTitle(n.kind, n.details), lines: structuredNoteLines(n.kind, n.details) })),
    })),
    otherLabs: otherLabs.map(labView),
    otherImaging: otherImaging.map((r) => ({ at: r.reportedAt ?? r.createdAt, line: imagingLine(r), findings: r.status === 'REPORTED' ? r.findings : null })),
  };
}
