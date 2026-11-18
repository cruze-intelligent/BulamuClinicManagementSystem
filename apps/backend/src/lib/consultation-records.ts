import { prisma } from './prisma';
import type { PrescriptionInput } from './clinical';
import { generateLabResultsPdf, generatePrescriptionPdf, PrescriptionPdfInput } from './pdf';
import { eatDateKey, eatDayRange } from './invoices';
import { facilityLogo } from './facility-logo';
import { roleTitle, type Signer } from './document-signer';
import { patientIdText } from './patient-text';

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

/** What a consultation's children look like when read back, in reading order. */
export const consultationChildren = {
  diagnoses: { orderBy: [{ type: 'asc' as const }, { createdAt: 'asc' as const }] },
  prescriptions: { orderBy: { createdAt: 'asc' as const }, include: { dispensedBy: { select: { name: true } } } },
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

/** Everything the printed prescription needs, for a consultation the caller has already been cleared to read. */
export async function buildPrescriptionPdf(consultationId: string, producedBy?: Signer | string | null): Promise<{ pdf: Buffer; clinicId: string } | null> {
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
  };
  return { pdf: await generatePrescriptionPdf(input), clinicId: consultation.appointment.clinicId };
}

/**
 * A patient's laboratory results as a printable PDF: the test asked for, and -
 * unless `only` - the patient's other results requested the same day (or at the
 * same visit), so someone who came for several tests gets them on one sheet.
 * Only tests with a result are printed. The caller has checked the clinic.
 */
export async function buildLabResultsPdf(testId: string, options: { only?: boolean; producedBy?: Signer | string | null } = {}): Promise<{ pdf: Buffer; clinicId: string } | { error: string; status: number } | null> {
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
  return { pdf, clinicId: patient.clinicId };
}
