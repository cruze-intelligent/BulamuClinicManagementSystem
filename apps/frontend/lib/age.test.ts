import { describe, expect, it } from 'vitest';
import { calculateAgeYears, calculateAgeDays, getHmisAgeCohort } from './age';

describe('calculateAgeYears', () => {
  it('computes whole years elapsed', () => {
    expect(calculateAgeYears('2000-01-01', new Date('2026-01-01'))).toBe(26);
  });

  it('has not had a birthday yet this year', () => {
    expect(calculateAgeYears('2000-06-15', new Date('2026-01-01'))).toBe(25);
  });

  it('birthday is today', () => {
    expect(calculateAgeYears('2000-01-01', new Date('2026-01-01'))).toBe(26);
  });
});

describe('calculateAgeDays', () => {
  it('computes whole days elapsed', () => {
    expect(calculateAgeDays('2026-01-01', new Date('2026-01-15'))).toBe(14);
  });
});

describe('getHmisAgeCohort', () => {
  it('buckets a neonate as 0-28 days', () => {
    expect(getHmisAgeCohort('2026-01-01', new Date('2026-01-20'))).toBe('0-28 days');
  });

  it('buckets a 2-year-old as 29 days-4 years', () => {
    expect(getHmisAgeCohort('2024-01-01', new Date('2026-01-01'))).toBe('29 days-4 years');
  });

  it('buckets a 7-year-old as 5-9 years', () => {
    expect(getHmisAgeCohort('2018-01-01', new Date('2026-01-01'))).toBe('5-9 years');
  });

  it('buckets a 15-year-old as 10-19 years', () => {
    expect(getHmisAgeCohort('2011-01-01', new Date('2026-01-01'))).toBe('10-19 years');
  });

  it('buckets a 30-year-old as 20+ years', () => {
    expect(getHmisAgeCohort('1996-01-01', new Date('2026-01-01'))).toBe('20+ years');
  });

  it('boundary: exactly 29 days old is not a neonate', () => {
    expect(getHmisAgeCohort('2026-01-01', new Date('2026-01-30'))).toBe('29 days-4 years');
  });
});
