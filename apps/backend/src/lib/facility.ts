import { prisma } from './prisma';

// Excludes ambiguous characters (0/O, 1/I/L) so codes are easy to read aloud
// or copy onto a printed document.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// Canonicalizes a Uganda phone number so "0756123456", "+256756123456", and
// "256756123456" all resolve to the same key for duplicate-facility lookups.
export function normalizePhoneKey(phone: string): string {
  const digits = (phone || '').replace(/\D/g, '');
  return digits.slice(-9);
}

export async function generateFacilityCode(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    let suffix = '';
    for (let i = 0; i < 6; i++) suffix += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    const code = `BLM-${suffix}`;
    const existing = await prisma.clinic.findUnique({ where: { facilityCode: code } });
    if (!existing) return code;
  }
  throw new Error('Could not generate a unique facility code');
}

// One free trial per real-world facility: a PENDING or APPROVED clinic
// already sharing this phone number means this facility (or someone
// claiming to be it) has already registered. A REJECTED prior attempt never
// received a trial, so a fresh registration is allowed.
export async function findDuplicateFacility(phone: string) {
  const phoneKey = normalizePhoneKey(phone);
  if (!phoneKey) return null;
  return prisma.clinic.findFirst({
    where: { phoneKey, deletedAt: null, registrationStatus: { in: ['PENDING', 'APPROVED'] } },
    select: { id: true, name: true, facilityCode: true, registrationStatus: true },
  });
}

export function duplicateFacilityMessage(match: { name: string; facilityCode: string; registrationStatus: string }): string {
  const statusText = match.registrationStatus === 'PENDING' ? 'awaiting review' : 'already active';
  return `A facility with this phone number is already registered on Bulamu (Facility ID: ${match.facilityCode}, ${statusText}). Each facility may only claim one free trial. If this is your facility, sign in instead or contact support.`;
}
