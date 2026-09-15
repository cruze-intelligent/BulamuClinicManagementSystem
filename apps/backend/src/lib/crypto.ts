import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey(): Buffer {
  const secret = process.env.INTEGRATION_ENCRYPTION_KEY || process.env.JWT_SECRET || 'bulamu_local_development_secret';
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Symmetric encryption for secrets we must be able to read back (e.g. a
 * partner integration's password) - not for passwords we only ever compare,
 * which stay bcrypt-hashed via auth/user routes.
 */
export function encryptSecret(plainText: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join('.');
}

export function decryptSecret(payload: string): string {
  const [ivB64, authTagB64, dataB64] = payload.split('.');
  if (!ivB64 || !authTagB64 || !dataB64) {
    throw new Error('Malformed encrypted payload');
  }

  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);

  return decrypted.toString('utf-8');
}

/**
 * One-way hash for password-reset tokens: the raw token is emailed/shown to
 * the user once and never stored - only its hash lives in the database, so a
 * database leak alone can't be used to reset accounts.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}
