import { prisma } from './prisma';
import { normalizePhoneKey } from './facility';

export { normalizePhoneKey };

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
