export function calculateAgeYears(dateOfBirth: string | Date, referenceDate: Date = new Date()): number {
  const dob = new Date(dateOfBirth);
  let age = referenceDate.getFullYear() - dob.getFullYear();
  const monthDiff = referenceDate.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && referenceDate.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

export function calculateAgeDays(dateOfBirth: string | Date, referenceDate: Date = new Date()): number {
  const dob = new Date(dateOfBirth);
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((referenceDate.getTime() - dob.getTime()) / msPerDay);
}

export type HmisAgeCohort = '0-28 days' | '29 days-4 years' | '5-9 years' | '10-19 years' | '20+ years';

/**
 * HMIS 105 age-cohort bucketing (0-28 days, 29 days-4 years, 5-9 years, ...).
 */
export function getHmisAgeCohort(dateOfBirth: string | Date, referenceDate: Date = new Date()): HmisAgeCohort {
  const days = calculateAgeDays(dateOfBirth, referenceDate);
  const years = calculateAgeYears(dateOfBirth, referenceDate);

  if (days <= 28) return '0-28 days';
  if (years <= 4) return '29 days-4 years';
  if (years <= 9) return '5-9 years';
  if (years <= 19) return '10-19 years';
  return '20+ years';
}

/**
 * A patient's age as a clinician states it: days for a newborn, months for a
 * young child, years otherwise ("12 days", "8 months", "34 years"). Doses and
 * many diagnoses depend on which of these it is.
 */
export function formatAge(dateOfBirth: string | Date, referenceDate: Date = new Date()): string {
  const days = calculateAgeDays(dateOfBirth, referenceDate);
  if (days < 0) return '';
  if (days < 31) return `${days} day${days === 1 ? '' : 's'}`;
  const months = Math.floor(days / 30.4375);
  if (months < 24) return `${months} month${months === 1 ? '' : 's'}`;
  const years = calculateAgeYears(dateOfBirth, referenceDate);
  return `${years} year${years === 1 ? '' : 's'}`;
}

export type AgeUnit = 'years' | 'months' | 'days';

/**
 * A date of birth worked out from an age the patient gives, when they do not
 * know their date of birth ("about 34 years", "8 months"). Counted back from
 * today; the record marks it as estimated.
 */
export function dateOfBirthFromAge(value: number, unit: AgeUnit, today: Date = new Date()): string {
  const d = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  if (unit === 'years') d.setUTCFullYear(d.getUTCFullYear() - value);
  else if (unit === 'months') d.setUTCMonth(d.getUTCMonth() - value);
  else d.setUTCDate(d.getUTCDate() - value);
  return d.toISOString().slice(0, 10);
}

/** What is wrong with an age typed in, or null. */
export function ageProblem(text: string, unit: AgeUnit): string | null {
  if (!text.trim()) return null;
  const n = Number(text);
  const max = unit === 'years' ? 130 : unit === 'months' ? 36 : 120;
  if (!Number.isInteger(n) || n < 0 || n > max) return `Enter the age as a whole number of ${unit}, up to ${max}`;
  return null;
}

/** The age as shown, with "(estimated)" when it came from an age rather than a known date of birth. */
export function ageText(dateOfBirth: string | Date, estimated?: boolean | null, referenceDate: Date = new Date()): string {
  const age = formatAge(dateOfBirth, referenceDate);
  return age && estimated ? `${age} (estimated)` : age;
}
