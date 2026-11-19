import type { ImagingModality } from '@prisma/client';
import { prisma } from './prisma';

/**
 * Imaging: the kinds of examination (modalities), where each kind of request
 * goes, and what a request and a report must hold. Kept in step with
 * apps/frontend/lib/imaging.ts.
 */
export const MODALITIES: Record<ImagingModality, string> = {
  XRAY: 'X-ray',
  ULTRASOUND: 'Ultrasound scan',
  CT: 'CT scan',
  MRI: 'MRI scan',
  MAMMOGRAPHY: 'Mammography',
  FLUOROSCOPY: 'Fluoroscopy',
  ECG: 'Electrocardiography (ECG/EKG)',
  OTHER: 'Other imaging',
};

export const isModality = (value: unknown): value is ImagingModality => typeof value === 'string' && value in MODALITIES;

/** The roles that request imaging, and those that report it. */
export const REQUEST_ROLES = ['DOCTOR', 'NURSE', 'ADMIN'] as const;
export const REPORT_ROLES = ['RADIOGRAPHER', 'DOCTOR', 'ADMIN'] as const;
export const WORKLIST_ROLES = ['RADIOGRAPHER', 'DOCTOR', 'NURSE', 'ADMIN'] as const;

const clean = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().replace(/[ \t]+/g, ' ').slice(0, max) : '');

export type RequestInput = { modality: ImagingModality; examination: string; clinicalInfo: string | null; urgent: boolean };

/** A request as typed: the modality, the examination in the requester's words, why, and how soon. */
export function parseImagingRequest(body: any): RequestInput | { error: string } {
  if (!isModality(body?.modality)) return { error: 'Choose the kind of imaging: X-ray, ultrasound scan, CT scan...' };
  const examination = clean(body.examination, 160);
  if (!examination) return { error: 'Say what should be examined, for example "Abdominal ultrasound" or "Chest X-ray"' };
  return { modality: body.modality, examination, clinicalInfo: clean(body.clinicalInfo, 1000) || null, urgent: body.urgent === true };
}

/** A report: what was seen, and the conclusion. */
export function parseImagingReport(body: any): { findings: string; impression: string } | { error: string } {
  const findings = clean(body?.findings, 5000);
  const impression = clean(body?.impression, 1000);
  if (!findings) return { error: 'Write the findings' };
  if (!impression) return { error: 'Write the impression - the conclusion the requester acts on' };
  return { findings, impression };
}

/**
 * The imaging unit a request goes to: scans to Ultrasound when the facility
 * has it, everything else (and scans otherwise) to Radiology; none when the
 * facility has no imaging unit - the request still reaches the Imaging page.
 */
export async function imagingUnitFor(clinicId: string, modality: ImagingModality): Promise<string | null> {
  const units = await prisma.department.findMany({ where: { clinicId, isActive: true, code: { in: ['RADIOLOGY', 'ULTRASOUND'] } }, select: { id: true, code: true } });
  const byCode = (code: string) => units.find((u) => u.code === code)?.id ?? null;
  return (modality === 'ULTRASOUND' ? byCode('ULTRASOUND') : null) ?? byCode('RADIOLOGY') ?? byCode('ULTRASOUND');
}

/** One line for a summary or a printout: "Abdominal ultrasound (Ultrasound scan) - impression". */
export function imagingLine(r: { modality: ImagingModality; examination: string; status: string; impression: string | null; urgent: boolean }): string {
  const what = `${r.examination} (${MODALITIES[r.modality]})${r.urgent ? ' - urgent' : ''}`;
  if (r.status === 'REPORTED') return `${what}: ${r.impression ?? 'reported'}`;
  if (r.status === 'CANCELLED') return `${what}: cancelled`;
  return `${what}: requested - no report yet`;
}
