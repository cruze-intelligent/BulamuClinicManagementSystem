import { describe, expect, it } from 'vitest';
import { encryptSecret, decryptSecret, hashToken, generateToken } from '../src/lib/crypto';

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a secret', () => {
    const encrypted = encryptSecret('super-secret-dhis2-password');
    expect(encrypted).not.toContain('super-secret-dhis2-password');
    expect(decryptSecret(encrypted)).toBe('super-secret-dhis2-password');
  });

  it('produces different ciphertext for the same plaintext each time (random IV)', () => {
    const a = encryptSecret('same-value');
    const b = encryptSecret('same-value');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('same-value');
    expect(decryptSecret(b)).toBe('same-value');
  });

  it('rejects a tampered payload', () => {
    const encrypted = encryptSecret('value');
    const tampered = encrypted.slice(0, -4) + 'abcd';
    expect(() => decryptSecret(tampered)).toThrow();
  });
});

describe('hashToken / generateToken', () => {
  it('generates a unique token each call', () => {
    expect(generateToken()).not.toBe(generateToken());
  });

  it('hashes deterministically so a stored hash can be matched later', () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it('never stores the raw token in its own hash', () => {
    const token = generateToken();
    expect(hashToken(token)).not.toBe(token);
  });
});
