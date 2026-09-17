import crypto from 'crypto';
import { prisma } from './prisma';
import { normalizePhoneKey } from './facility';

export { normalizePhoneKey };

// 6-digit numeric OTP proving whoever is physically present at a new
// facility's front desk is really the account holder - readable off a phone
// screen or SMS/email without transcription errors an alphanumeric code
// risks.
export function generateOtp(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

// Excludes ambiguous characters (0/O, 1/I/L) so codes are easy to read aloud
// or copy onto a printed document - same alphabet as facility codes.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export async function generatePortableId(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    let suffix = '';
    for (let i = 0; i < 6; i++) suffix += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    const id = `BLM-P-${suffix}`;
    const existing = await prisma.patientAccount.findUnique({ where: { portableId: id } });
    if (!existing) return id;
  }
  throw new Error('Could not generate a unique patient portable ID');
}

// A patient may only hold one portable account - staff attempting to create
// a second one for the same phone number should link the existing account
// to their facility's Patient row instead (the cross-facility validate
// flow), not create a duplicate identity.
export async function findAccountByPhone(phone: string) {
  const phoneKey = normalizePhoneKey(phone);
  if (!phoneKey) return null;
  return prisma.patientAccount.findFirst({
    where: { phoneKey },
    select: { id: true, portableId: true, status: true },
  });
}
