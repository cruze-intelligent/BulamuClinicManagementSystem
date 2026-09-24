import { prisma } from './prisma';
import type { PrescriptionInput } from './clinical';
import { generatePrescriptionPdf, PrescriptionPdfInput } from './pdf';

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
  prescriptions: { orderBy: { createdAt: 'asc' as const } },
};

/** "34 years", "8 months", "12 days" - a child's dose depends on age, so a prescription states it. */
function ageLabel(dateOfBirth: Date | null, at: Date): string | undefined {
  if (!dateOfBirth) return undefined;
  const days = Math.floor((at.getTime() - dateOfBirth.getTime()) / 86_400_000);
  if (days < 0) return undefined;
  if (days < 31) return `${days} day${days === 1 ? '' : 's'}`;
  const months = Math.floor(days / 30.4375);
  if (months < 24) return `${months} month${months === 1 ? '' : 's'}`;
  const years = Math.floor(days / 365.25);
  return `${years} year${years === 1 ? '' : 's'}`;
}

/** Everything the printed prescription needs, for a consultation the caller has already been cleared to read. */
export async function buildPrescriptionPdf(consultationId: string): Promise<{ pdf: Buffer; clinicId: string } | null> {
  const consultation = await prisma.consultation.findFirst({
    where: { id: consultationId, deletedAt: null },
    include: {
      ...consultationChildren,
      patient: { select: { name: true, phone: true, sex: true, dateOfBirth: true, clinic: { select: { name: true, facilityCode: true } } } },
      appointment: { select: { clinicId: true, doctor: { select: { name: true } } } },
    },
  });
  if (!consultation) return null;

  const input: PrescriptionPdfInput = {
    consultationId: consultation.id,
    clinicName: consultation.patient.clinic.name,
    facilityCode: consultation.patient.clinic.facilityCode,
    patientName: consultation.patient.name,
    patientPhone: consultation.patient.phone,
    patientSex: consultation.patient.sex,
    patientAge: ageLabel(consultation.patient.dateOfBirth, consultation.createdAt),
    prescriberName: consultation.appointment.doctor?.name,
    date: consultation.createdAt,
    diagnoses: consultation.diagnoses,
    prescriptions: consultation.prescriptions,
  };
  return { pdf: await generatePrescriptionPdf(input), clinicId: consultation.appointment.clinicId };
}
