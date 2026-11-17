/**
 * The facility's units (departments / clinics): General OPD, Dentistry,
 * Orthopaedics, Eye clinic... Each patient visit belongs to one, each has its
 * own waiting queue, staff are assigned to the units they work in, and the
 * monthly report counts visits per unit.
 *
 * A facility picks its units from the standard list below (the same codes
 * everywhere, so figures compare across facilities) or names its own.
 * Kept in step with apps/backend/src/lib/departments.ts.
 */

export type Department = { id: string; code: string | null; name: string; isActive: boolean; staff?: number };

export const STANDARD_UNITS: ReadonlyArray<{ code: string; name: string; hint: string }> = [
  { code: 'OPD', name: 'General OPD', hint: 'General outpatients' },
  { code: 'CASUALTY', name: 'Emergency / Casualty', hint: 'Emergencies and trauma' },
  { code: 'MEDICINE', name: 'Internal Medicine', hint: 'Medical outpatients' },
  { code: 'SURGERY', name: 'General Surgery', hint: 'Surgical outpatients' },
  { code: 'PAEDIATRICS', name: 'Paediatrics', hint: "Children's clinic" },
  { code: 'OBGYN', name: 'Obstetrics & Gynaecology', hint: "Women's health" },
  { code: 'ANC', name: 'Antenatal Care (ANC)', hint: 'Pregnancy check-ups' },
  { code: 'MATERNITY', name: 'Maternity', hint: 'Labour, delivery and postnatal care' },
  { code: 'FAMILY_PLANNING', name: 'Family Planning', hint: 'Contraception and counselling' },
  { code: 'IMMUNISATION', name: 'Immunisation (EPI)', hint: 'Vaccinations' },
  { code: 'DENTAL', name: 'Dentistry', hint: 'Teeth and gums' },
  { code: 'ORTHOPAEDICS', name: 'Orthopaedics', hint: 'Bones, joints and fractures' },
  { code: 'EYE', name: 'Eye Clinic (Ophthalmology)', hint: 'Eyes and sight' },
  { code: 'ENT', name: 'Ear, Nose & Throat (ENT)', hint: 'Ears, nose and throat' },
  { code: 'DERMATOLOGY', name: 'Skin Clinic (Dermatology)', hint: 'Skin conditions' },
  { code: 'MENTAL_HEALTH', name: 'Mental Health', hint: 'Psychiatry and counselling' },
  { code: 'HIV_ART', name: 'HIV Care / ART Clinic', hint: 'HIV treatment and follow-up' },
  { code: 'TB', name: 'TB Clinic', hint: 'Tuberculosis treatment' },
  { code: 'NCD', name: 'Diabetes & Hypertension (NCD)', hint: 'Long-term conditions' },
  { code: 'NUTRITION', name: 'Nutrition', hint: 'Malnutrition and feeding' },
  { code: 'PHYSIOTHERAPY', name: 'Physiotherapy', hint: 'Rehabilitation' },
  { code: 'RADIOLOGY', name: 'Radiology (X-ray & CT)', hint: 'X-ray, CT and other imaging requests go here' },
  { code: 'ULTRASOUND', name: 'Ultrasound (Scan)', hint: 'Ultrasound scan requests go here' },
];

const cacheKey = (clinicId: string) => `departments_${clinicId}`;
const MINE_KEY = 'myDepartmentIds';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Keeps the facility's units on this device, so booking and the queue work offline. */
export function rememberDepartments(clinicId: string, departments: Department[], mine?: string[]) {
  try {
    localStorage.setItem(cacheKey(clinicId), JSON.stringify(departments));
    if (mine) localStorage.setItem(MINE_KEY, JSON.stringify(mine));
    window.dispatchEvent(new Event('bulamu:departments'));
  } catch {
    // Storage full or blocked: the next sync tries again.
  }
}

/** Every unit this device knows of for the facility, closed ones included (old visits still name them). */
export function knownDepartments(clinicId: string | undefined): Department[] {
  if (!clinicId || typeof window === 'undefined') return [];
  return read<Department[]>(cacheKey(clinicId), []);
}

/** The units patients can be booked into, in a steady order: the standard order, then the facility's own. */
export function activeDepartments(clinicId: string | undefined): Department[] {
  return sortDepartments(knownDepartments(clinicId).filter((d) => d.isActive));
}

/** The units the signed-in person works in (empty: they work across the facility). */
export function myDepartmentIds(): string[] {
  if (typeof window === 'undefined') return [];
  return read<string[]>(MINE_KEY, []);
}

export function sortDepartments<T extends { code: string | null; name: string }>(departments: T[]): T[] {
  const rank = (d: T) => {
    const i = STANDARD_UNITS.findIndex((u) => u.code === d.code);
    return i < 0 ? STANDARD_UNITS.length : i;
  };
  return [...departments].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export function departmentName(departments: Department[], id: string | null | undefined): string | null {
  if (!id) return null;
  return departments.find((d) => d.id === id)?.name ?? null;
}

/** The unit a new visit goes to by default: the person's own unit, else General OPD, else the only one. */
export function defaultDepartmentId(departments: Department[], mine: string[] = myDepartmentIds()): string {
  const active = departments.filter((d) => d.isActive);
  const own = active.find((d) => mine.includes(d.id));
  if (own) return own.id;
  const opd = active.find((d) => d.code === 'OPD');
  if (opd) return opd.id;
  return active.length === 1 ? active[0].id : '';
}
