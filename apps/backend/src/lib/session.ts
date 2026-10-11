import { createHash } from 'crypto';

/** How long a sign-in lasts: a working shift, or 30 days with "Keep me signed in". */
export const STANDARD_SESSION = '12h';
export const REMEMBERED_SESSION = '30d';

/**
 * A short fingerprint of the stored password hash, carried in the session
 * token. When the password is changed or reset the fingerprint no longer
 * matches, so every existing session - including a 30-day one on a lost
 * phone - stops working. It reveals nothing usable about the password.
 */
export function passwordStamp(passwordHash: string): string {
  return createHash('sha256').update(passwordHash).digest('base64url').slice(0, 12);
}
