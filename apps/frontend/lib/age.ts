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
