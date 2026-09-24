import { describe, expect, it } from 'vitest';
import { ICD10_COMMON, ICD10_PATTERN, findIcd10, searchIcd10 } from './icd10';

describe('ICD-10 quick list', () => {
  it('holds only well-formed, unique codes with a name and a group', () => {
    const seen = new Set<string>();
    for (const entry of ICD10_COMMON) {
      expect(entry.code, entry.code).toMatch(ICD10_PATTERN);
      expect(entry.name.trim().length, entry.code).toBeGreaterThan(2);
      expect(entry.group.trim().length, entry.code).toBeGreaterThan(0);
      expect(seen.has(entry.code), `duplicate ${entry.code}`).toBe(false);
      seen.add(entry.code);
    }
  });

  it('covers the conditions the HMIS 105 report singles out', () => {
    const codes = ICD10_COMMON.map((e) => e.code);
    for (const wanted of ['B50.9', 'B54', 'R50.9', 'A09', 'A03.9', 'B05.9', 'G00.9', 'J18.9', 'J06.9', 'I10', 'E11.9', 'B20', 'A15.0', 'D64.9', 'N39.0']) {
      expect(codes).toContain(wanted);
    }
  });

  it('accepts real ICD-10 shapes and rejects everything else', () => {
    for (const ok of ['B54', 'J18.9', 'O80', 'S52.501', 'A00.9']) expect(ICD10_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ['b54', 'B5', 'B544', 'malaria', 'J18.', 'J18.99999', '12A', '']) expect(ICD10_PATTERN.test(bad), bad).toBe(false);
  });

  it('looks a code up regardless of case or spaces', () => {
    expect(findIcd10(' j18.9 ')?.name).toMatch(/pneumonia/i);
    expect(findIcd10('X99')).toBeUndefined();
    expect(findIcd10(null)).toBeUndefined();
  });
});

describe('searching the ICD-10 list', () => {
  const codesFor = (q: string) => searchIcd10(q, 20).map((e) => e.code);

  it('finds a condition by its name, its code, or the everyday term people use', () => {
    expect(codesFor('malaria')).toContain('B54');
    expect(codesFor('pneumonia')).toContain('J18.9');
    expect(codesFor('urti')[0]).toBe('J06.9');
    expect(codesFor('high blood pressure')).toContain('I10');
    expect(codesFor('low blood sugar')).toContain('E16.2');
    expect(codesFor('tb')).toContain('A15.0');
  });

  it('puts an exact code first, then codes that start with what was typed', () => {
    expect(codesFor('B54')[0]).toBe('B54');
    expect(codesFor('j18')[0]).toBe('J18.9');
  });

  it('needs every word typed to match, in any order', () => {
    expect(codesFor('acute bronch')).toContain('J20.9');
    expect(codesFor('bronchitis acute')).toContain('J20.9');
    expect(codesFor('acute cardiology')).toEqual([]);
  });

  it('returns nothing for empty or meaningless input, and respects the limit', () => {
    expect(searchIcd10('')).toEqual([]);
    expect(searchIcd10('   ')).toEqual([]);
    expect(searchIcd10('zzzzqq')).toEqual([]);
    expect(searchIcd10('a', 3).length).toBeLessThanOrEqual(3);
  });
});
