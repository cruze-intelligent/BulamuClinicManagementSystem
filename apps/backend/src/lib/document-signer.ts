import { prisma } from './prisma';
import type { Signer } from './pdf';

// How a staff member's role is written on a document they sign or produce.
const ROLE_TITLES: Record<string, string> = {
  ADMIN: 'Administrator',
  DOCTOR: 'Doctor / Clinical Officer',
  NURSE: 'Nurse / Midwife',
  PHARMACIST: 'Pharmacist',
  STAFF: 'Front Desk',
  LAB_TECH: 'Laboratory Technician',
  SUPER_ADMIN: 'Bulamu platform administrator',
};

export type { Signer };

export function roleTitle(role: string | null | undefined): string {
  return (role && ROLE_TITLES[role]) || 'Staff';
}

/** A staff member as written on a document ("Grace Nankya, Administrator"). */
export function signer(user: { name: string; role: string } | null | undefined): Signer | null {
  return user ? { name: user.name, role: roleTitle(user.role) } : null;
}

/** The staff member producing a document right now, for its footer. */
export async function documentProducer(userId: string): Promise<Signer | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, role: true } });
  return signer(user);
}
