import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import type { PrescriptionInput, ProcedureInput } from './clinical';
import { generateLabResultsPdf, generatePrescriptionPdf, PrescriptionPdfInput } from './pdf';
import { eatDateKey, eatDayRange } from './invoices';
import { facilityLogo } from './facility-logo';
import { roleTitle, type Signer } from './document-signer';
import { patientIdText } from './patient-text';
import { MODALITIES } from './imaging';
import { documentFileName } from './document-name';

/**
 * Keeps a prescription's link to a stock item only when that item really is one
 * of this facility's medicines. The link is a convenience for the pharmacist,
 * not something a request may rely on to reach another facility's stock, so an
 * unknown or foreign id is dropped rather than failing the whole consultation.
 */
export async function linkStockItems(clinicId: string, prescriptions: PrescriptionInput[]): Promise<PrescriptionInput[]> {
  const ids = [...new Set(prescriptions.map((p) => p.medicineId).filter((id): id is string => !!id))];
  if (ids.length === 0) return prescriptions;

  const owned = await prisma.medicine.findMany({
    where: { id: { in: ids }, clinicId, deletedAt: null },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((m) => m.id));
  return prescriptions.map((p) => (p.medicineId && !ownedIds.has(p.medicineId) ? { ...p, medicineId: null } : p));
}

/**
 * A visit's procedures, replaced by the list just saved. One already on the bill
 * stays, so a charge never loses what it was for; listed again, it is not added twice.
 */
export async function replaceVisitProcedures(tx: Prisma.TransactionClient, consultationId: string, procedures: ProcedureInput[]) {
  const billed = await tx.visitProcedure.findMany({ where: { consultationId, invoiceItem: { isNot: null } } });
  await tx.visitProcedure.deleteMany({ where: { consultationId, invoiceItem: null } });
  const key = (p: { name: string; notes: string | null }) => `${p.name.toLowerCase()}|${(p.notes ?? '').toLowerCase()}`;
  const kept = billed.map(key);
  const toCreate = procedures.filter((p) => {
    const at = kept.indexOf(key(p));
    if (at === -1) return true;
    kept.splice(at, 1);
    return false;
  });
  if (toCreate.length) await tx.visitProcedure.createMany({ data: toCreate.map((p) => ({ ...p, consultationId })) });
}

/** What a consultation's children look like when read back, in reading order. */
export const consultationChildren = {
  diagnoses: { orderBy: [{ type: 'asc' as const }, { createdAt: 'asc' as const }] },
  prescriptions: { orderBy: { createdAt: 'asc' as const }, include: { dispensedBy: { select: { name: true } } } },
  procedures: { orderBy: { createdAt: 'asc' as const } },
};

/** "34 years", "8 months", "12 days" - a child's dose depends on age, so a prescription states it. */
function ageLabel(dateOfBirth: Date | null, at: Date, estimated = false): string | undefined {
  if (!dateOfBirth) return undefined;
  const exact = exactAgeLabel(dateOfBirth, at);
  return exact && estimated ? `${exact} (estimated)` : exact;
}

function exactAgeLabel(dateOfBirth: Date, at: Date): string | undefined {
  const days = Math.floor((at.getTime() - dateOfBirth.getTime()) / 86_400_000);
  if (days < 0) return undefined;
  if (days < 31) return `${days} day${days === 1 ? '' : 's'}`;
  const months = Math.floor(days / 30.4375);
  if (months < 24) return `${months} month${months === 1 ? '' : 's'}`;
  const years = Math.floor(days / 365.25);
  return `${years} year${years === 1 ? '' : 's'}`;
}

/** Everything the visit's printed medical form needs, for a consultation the caller has already been cleared to read. */
export async function buildPrescriptionPdf(consultationId: string, producedBy?: Signer | string | null): Promise<{ pdf: Buffer; clinicId: string; fileName: string } | null> {
  const consultation = await prisma.consultation.findFirst({
    where: { id: consultationId, deletedAt: null },
    include: {
      ...consultationChildren,
      patient: { select: { name: true, phone: true, sex: true, dateOfBirth: true, dateOfBirthEstimated: true, patientNumber: true, clinic: { select: { name: true, facilityCode: true, phone: true, motto: true } } } },
      appointment: { select: { clinicId: true, doctor: { select: { name: true, role: true } } } },
      recordedBy: { select: { name: true, role: true } },
    },
  });
  if (!consultation) return null;

  const input: PrescriptionPdfInput = {
    consultationId: consultation.id,
    clinicName: consultation.patient.clinic.name,
    facilityCode: consultation.patient.clinic.facilityCode,
    clinicLogo: await facilityLogo(consultation.appointment.clinicId),
    clinicPhone: consultation.patient.clinic.phone,
    clinicMotto: consultation.patient.clinic.motto,
    patientName: consultation.patient.name,
    patientNumber: patientIdText(consultation.patient.patientNumber),
    patientPhone: consultation.patient.phone,
    patientSex: consultation.patient.sex,
    patientAge: ageLabel(consultation.patient.dateOfBirth, consultation.createdAt, consultation.patient.dateOfBirthEstimated),
    // The clinician who recorded the visit; for older visits, the doctor it was booked with.
    prescriberName: (consultation.recordedBy ?? consultation.appointment.doctor)?.name,
    prescriberRole: (consultation.recordedBy ?? consultation.appointment.doctor) ? roleTitle((consultation.recordedBy ?? consultation.appointment.doctor)!.role) : undefined,
    producedBy,
    date: consultation.createdAt,
    presentingComplaint: consultation.symptoms,
    diagnoses: consultation.diagnoses,
    prescriptions: consultation.prescriptions,
    procedures: consultation.procedures,
  };
  return {
    pdf: await generatePrescriptionPdf(input),
    clinicId: consultation.appointment.clinicId,
    fileName: documentFileName('Medical form', consultation.patient.name, consultation.createdAt),
  };
}

/**
 * A patient's laboratory results as a printable PDF: the test asked for, and -
 * unless `only` - the patient's other results requested the same day (or at the
 * same visit), so someone who came for several tests gets them on one sheet.
 * Only tests with a result are printed. The caller has checked the clinic.
 */
export async function buildLabResultsPdf(testId: string, options: { only?: boolean; producedBy?: Signer | string | null } = {}): Promise<{ pdf: Buffer; clinicId: string; fileName: string } | { error: string; status: number } | null> {
  const test = await prisma.labTest.findFirst({ where: { id: testId, deletedAt: null }, select: { id: true, patientId: true, consultationId: true, createdAt: true } });
  if (!test) return null;
  const { start, end } = eatDayRange(eatDateKey(test.createdAt));
  const tests = await prisma.labTest.findMany({
    where: {
      patientId: test.patientId, deletedAt: null, status: 'COMPLETED',
      ...(options.only ? { id: test.id } : { OR: [{ id: test.id }, { createdAt: { gte: start, lt: end } }, ...(test.consultationId ? [{ consultationId: test.consultationId }] : [])] }),
    },
    include: { resultedBy: { select: { name: true, role: true } }, verifiedBy: { select: { name: true, role: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const printable = tests.filter((t) => t.results.trim());
  if (!printable.some((t) => t.id === test.id)) return { error: 'This test has no result to print yet', status: 409 };

  const patient = await prisma.patient.findUniqueOrThrow({
    where: { id: test.patientId },
    select: { name: true, phone: true, sex: true, dateOfBirth: true, dateOfBirthEstimated: true, patientNumber: true, clinicId: true, clinic: { select: { name: true, facilityCode: true, phone: true, motto: true } } },
  });
  const staff = (u: { name: string; role: string } | null) => (u ? { name: u.name, role: roleTitle(u.role) } : null);
  const pdf = await generateLabResultsPdf({
    clinicName: patient.clinic.name,
    facilityCode: patient.clinic.facilityCode,
    clinicPhone: patient.clinic.phone,
    clinicMotto: patient.clinic.motto,
    clinicLogo: await facilityLogo(patient.clinicId),
    patientName: patient.name,
    patientNumber: patientIdText(patient.patientNumber),
    patientPhone: patient.phone,
    patientSex: patient.sex,
    patientAge: ageLabel(patient.dateOfBirth, test.createdAt, patient.dateOfBirthEstimated),
    tests: printable.map((t) => ({
      id: t.id, testName: t.testName, results: t.results, orderedBy: t.orderedBy, requestedAt: t.createdAt,
      values: Array.isArray(t.values) ? (t.values as any) : null, comment: t.comment,
      resultedBy: staff(t.resultedBy), resultedAt: t.resultedAt, verifiedBy: staff(t.verifiedBy), verifiedAt: t.verifiedAt,
    })),
    producedBy: options.producedBy,
  });
  const latest = printable.map((t) => t.createdAt).reduce((a, b) => (b > a ? b : a));
  return { pdf, clinicId: patient.clinicId, fileName: documentFileName('Laboratory results', patient.name, latest) };
}

/**
 * The results chosen to print together - lab tests and imaging reports of one
 * patient - on as few pages as they need (several short results share one table).
 */
export async function buildChosenResultsPdf(
  clinicId: string,
  chosen: { labIds: string[]; imagingIds: string[] },
  producedBy?: Signer | string | null,
): Promise<{ pdf: Buffer; patientId: string; fileName: string } | { error: string; status: number }> {
  const [tests, reports] = await Promise.all([
    chosen.labIds.length
      ? prisma.labTest.findMany({
          where: { id: { in: chosen.labIds }, deletedAt: null, status: 'COMPLETED', patient: { clinicId } },
          include: { resultedBy: { select: { name: true, role: true } }, verifiedBy: { select: { name: true, role: true } } },
          orderBy: { createdAt: 'asc' },
        })
      : [],
    chosen.imagingIds.length
      ? prisma.imagingRequest.findMany({ where: { id: { in: chosen.imagingIds }, clinicId, status: 'REPORTED' }, orderBy: { createdAt: 'asc' } })
      : [],
  ]);
  const printable = tests.filter((t) => t.results.trim());
  if (!printable.length && !reports.length) return { error: 'Choose at least one result to print', status: 400 };
  const patientIds = new Set([...printable.map((t) => t.patientId), ...reports.map((r) => r.patientId)]);
  if (patientIds.size > 1) return { error: 'Choose results for one patient at a time - each patient gets their own copy', status: 400 };
  const patientId = [...patientIds][0];

  const patient = await prisma.patient.findUniqueOrThrow({
    where: { id: patientId },
    select: { name: true, phone: true, sex: true, dateOfBirth: true, dateOfBirthEstimated: true, patientNumber: true, clinicId: true, clinic: { select: { name: true, facilityCode: true, phone: true, motto: true } } },
  });
  const staff = (u: { name: string; role: string } | null) => (u ? { name: u.name, role: roleTitle(u.role) } : null);
  const reporters = await prisma.user.findMany({ where: { id: { in: reports.map((r) => r.reportedByUserId).filter((x): x is string => !!x) } }, select: { id: true, name: true, role: true } });
  const firstDate = [...printable.map((t) => t.createdAt), ...reports.map((r) => r.createdAt)].reduce((a, b) => (b < a ? b : a));
  const pdf = await generateLabResultsPdf({
    clinicName: patient.clinic.name,
    facilityCode: patient.clinic.facilityCode,
    clinicPhone: patient.clinic.phone,
    clinicMotto: patient.clinic.motto,
    clinicLogo: await facilityLogo(patient.clinicId),
    patientName: patient.name,
    patientNumber: patientIdText(patient.patientNumber),
    patientPhone: patient.phone,
    patientSex: patient.sex,
    patientAge: ageLabel(patient.dateOfBirth, firstDate, patient.dateOfBirthEstimated),
    tests: printable.map((t) => ({
      id: t.id, testName: t.testName, results: t.results, orderedBy: t.orderedBy, requestedAt: t.createdAt,
      values: Array.isArray(t.values) ? (t.values as any) : null, comment: t.comment,
      resultedBy: staff(t.resultedBy), resultedAt: t.resultedAt, verifiedBy: staff(t.verifiedBy), verifiedAt: t.verifiedAt,
    })),
    imaging: reports.map((r) => {
      const by = reporters.find((u) => u.id === r.reportedByUserId);
      return {
        examination: r.examination, modality: MODALITIES[r.modality], findings: r.findings, impression: r.impression,
        requestedBy: r.requestedBy, requestedAt: r.createdAt, reportedAt: r.reportedAt,
        reportedBy: r.reportedBy ? { name: r.reportedBy, role: by ? roleTitle(by.role) : 'Imaging' } : null,
      };
    }),
    producedBy,
  });
  const latest = [...printable.map((t) => t.createdAt), ...reports.map((r) => r.createdAt)].reduce((a, b) => (b > a ? b : a));
  const kind = printable.length && reports.length ? 'Laboratory and imaging results' : reports.length ? 'Imaging results' : 'Laboratory results';
  return { pdf, patientId, fileName: documentFileName(kind, patient.name, latest) };
}
