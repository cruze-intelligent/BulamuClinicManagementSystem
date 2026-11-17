/**
 * The facility's units (departments / clinics): General OPD, Dentistry,
 * Orthopaedics, Eye clinic... Each patient visit belongs to one, each has its
 * own waiting queue, staff are assigned to the units they work in, and the
 * monthly report counts visits per unit.
 *
 * A facility picks its units from this standard list (the same codes
 * everywhere, so figures compare across facilities) or names its own.
 * Kept in step with apps/frontend/lib/departments.ts.
 */
export const STANDARD_UNITS: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'OPD', name: 'General OPD' },
  { code: 'CASUALTY', name: 'Emergency / Casualty' },
  { code: 'MEDICINE', name: 'Internal Medicine' },
  { code: 'SURGERY', name: 'General Surgery' },
  { code: 'PAEDIATRICS', name: 'Paediatrics' },
  { code: 'OBGYN', name: 'Obstetrics & Gynaecology' },
  { code: 'ANC', name: 'Antenatal Care (ANC)' },
  { code: 'MATERNITY', name: 'Maternity' },
  { code: 'FAMILY_PLANNING', name: 'Family Planning' },
  { code: 'IMMUNISATION', name: 'Immunisation (EPI)' },
  { code: 'DENTAL', name: 'Dentistry' },
  { code: 'ORTHOPAEDICS', name: 'Orthopaedics' },
  { code: 'EYE', name: 'Eye Clinic (Ophthalmology)' },
  { code: 'ENT', name: 'Ear, Nose & Throat (ENT)' },
  { code: 'DERMATOLOGY', name: 'Skin Clinic (Dermatology)' },
  { code: 'MENTAL_HEALTH', name: 'Mental Health' },
  { code: 'HIV_ART', name: 'HIV Care / ART Clinic' },
  { code: 'TB', name: 'TB Clinic' },
  { code: 'NCD', name: 'Diabetes & Hypertension (NCD)' },
  { code: 'NUTRITION', name: 'Nutrition' },
  { code: 'PHYSIOTHERAPY', name: 'Physiotherapy' },
  { code: 'RADIOLOGY', name: 'Radiology (X-ray & CT)' },
  { code: 'ULTRASOUND', name: 'Ultrasound (Scan)' },
];

export const MAX_UNIT_NAME = 60;

export const standardUnit = (code: unknown) => STANDARD_UNITS.find((u) => u.code === code);

/** A unit's name as typed: trimmed, single-spaced; an error when it is empty or too long. */
export function cleanUnitName(value: unknown): { name: string } | { error: string } {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!name) return { error: 'Give the unit a name, for example "Dentistry"' };
  if (name.length > MAX_UNIT_NAME) return { error: `Keep the unit name to ${MAX_UNIT_NAME} characters` };
  return { name };
}

/** Standard units first, in the standard order, then the facility's own by name. */
export function sortDepartments<T extends { code: string | null; name: string }>(departments: T[]): T[] {
  const rank = (d: T) => {
    const i = STANDARD_UNITS.findIndex((u) => u.code === d.code);
    return i < 0 ? STANDARD_UNITS.length : i;
  };
  return [...departments].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
