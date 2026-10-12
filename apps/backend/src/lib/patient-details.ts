import { isValidEmail } from './portal-invite';

const SEXES = ['FEMALE', 'MALE', 'OTHER'] as const;

const TEXT_FIELDS = ['village', 'parish', 'subCounty', 'district', 'nextOfKinName', 'nextOfKinPhone'] as const;

export type PatientDetails = {
  name?: string;
  phone?: string;
  email?: string | null;
  sex?: (typeof SEXES)[number] | null;
  dateOfBirth?: Date | null;
} & Partial<Record<(typeof TEXT_FIELDS)[number], string | null>>;

/**
 * The registration details in an edit, checked. Only the fields sent are
 * changed; an empty optional field clears it. Name and phone can't be cleared.
 */
export function parsePatientDetails(body: Record<string, unknown>, now: Date = new Date()): { data: PatientDetails } | { error: string } {
  const data: PatientDetails = {};
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

  if (body.name !== undefined) {
    const name = text(body.name);
    if (!name) return { error: "Enter the patient's name" };
    data.name = name;
  }
  if (body.phone !== undefined) {
    const phone = text(body.phone);
    if (!phone) return { error: "Enter the patient's phone number" };
    data.phone = phone;
  }
  if (body.email !== undefined) {
    const email = text(body.email);
    if (email && !isValidEmail(email)) return { error: 'Enter a valid email address, or leave it empty' };
    data.email = email ? email.toLowerCase() : null;
  }
  if (body.sex !== undefined) {
    const sex = text(body.sex);
    if (sex && !SEXES.includes(sex as (typeof SEXES)[number])) return { error: 'Sex must be female, male or other' };
    data.sex = sex ? (sex as (typeof SEXES)[number]) : null;
  }
  if (body.dateOfBirth !== undefined) {
    const raw = text(body.dateOfBirth);
    if (raw) {
      const date = new Date(raw);
      if (Number.isNaN(date.getTime())) return { error: 'Enter a valid date of birth' };
      if (date > now) return { error: "The date of birth can't be in the future" };
      data.dateOfBirth = date;
    } else {
      data.dateOfBirth = null;
    }
  }
  for (const field of TEXT_FIELDS) {
    if (body[field] !== undefined) data[field] = text(body[field]) || null;
  }
  return { data };
}
