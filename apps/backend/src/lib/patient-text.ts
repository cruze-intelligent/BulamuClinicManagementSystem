import { calculateAgeDays, calculateAgeYears } from './age';

// How a patient is described on letters and summaries that leave the system
// (referral letters, discharge summaries, shared history).

export function sexAgeText(patient: { sex?: string | null; dateOfBirth?: Date | null }, at: Date = new Date()): string | null {
  const sex = patient.sex ? patient.sex.charAt(0) + patient.sex.slice(1).toLowerCase() : null;
  let age: string | null = null;
  if (patient.dateOfBirth) {
    const years = calculateAgeYears(patient.dateOfBirth, at);
    if (years >= 2) age = `${years} years`;
    else {
      const days = calculateAgeDays(patient.dateOfBirth, at);
      age = days < 60 ? `${days} days` : `${Math.floor(days / 30.44)} months`;
    }
  }
  return [age, sex].filter(Boolean).join(', ') || null;
}

export function addressText(patient: { village?: string | null; parish?: string | null; subCounty?: string | null; district?: string | null }): string | null {
  return [patient.village, patient.parish, patient.subCounty, patient.district].filter(Boolean).join(', ') || null;
}

export function nextOfKinText(patient: { nextOfKinName?: string | null; nextOfKinPhone?: string | null }): string | null {
  return [patient.nextOfKinName, patient.nextOfKinPhone].filter(Boolean).join(' - ') || null;
}

/** Always says something: an unknown allergy status is itself important to the next clinician. */
export function allergyText(patient: { allergyStatus?: string | null; allergies?: unknown }): string {
  if (patient.allergyStatus === 'NONE_KNOWN') return 'No known allergies';
  if (patient.allergyStatus !== 'KNOWN') return 'Not recorded - ask the patient';
  const list = Array.isArray(patient.allergies) ? (patient.allergies as Array<{ substance?: string; reaction?: string | null; severity?: string | null }>) : [];
  if (list.length === 0) return 'Allergies recorded, details not given - ask the patient';
  return list
    .map((a) => [a.substance, a.severity ? a.severity.toLowerCase() : null, a.reaction].filter(Boolean).join(' - '))
    .join('; ');
}
