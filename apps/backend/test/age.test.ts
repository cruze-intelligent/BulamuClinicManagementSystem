import { describe, expect, it } from 'vitest';
import { calculateAgeYears, getHmisAgeCohort } from '../src/lib/age';

describe('calculateAgeYears', () => {
  it('computes whole years elapsed', () => {
    expect(calculateAgeYears(new Date('2000-01-01'), new Date('2026-01-01'))).toBe(26);
  });
});

describe('getHmisAgeCohort', () => {
  it('buckets a neonate as 0-28 days', () => {
    expect(getHmisAgeCohort(new Date('2026-01-01'), new Date('2026-01-20'))).toBe('0-28 days');
  });

  it('buckets a 30-year-old as 20+ years', () => {
    expect(getHmisAgeCohort(new Date('1996-01-01'), new Date('2026-01-01'))).toBe('20+ years');
  });
});
