import { describe, expect, it } from 'vitest';
import { patientIdQuery, patientIdText } from './patient-id';
import { ageProblem, ageText, dateOfBirthFromAge } from './age';

describe('Patient IDs', () => {
  it('print as five digits and are found however they are typed', () => {
    expect(patientIdText(42)).toBe('00042');
    expect(patientIdText(123456)).toBe('123456');
    expect(patientIdText(null)).toBeNull();
    expect(patientIdQuery('42')).toBe(42);
    expect(patientIdQuery(' 00042 ')).toBe(42);
    expect(patientIdQuery('0772 123')).toBeNull();
    expect(patientIdQuery('Achieng')).toBeNull();
    expect(patientIdQuery('0')).toBeNull();
  });
});

describe('an age instead of a date of birth', () => {
  const today = new Date(2026, 10, 17);
  it('works out a date of birth from years, months or days, counted back from today', () => {
    expect(dateOfBirthFromAge(34, 'years', today)).toBe('1992-11-17');
    expect(dateOfBirthFromAge(8, 'months', today)).toBe('2026-03-17');
    expect(dateOfBirthFromAge(12, 'days', today)).toBe('2026-11-05');
  });

  it('checks the age typed in', () => {
    expect(ageProblem('34', 'years')).toBeNull();
    expect(ageProblem('', 'years')).toBeNull();
    expect(ageProblem('34.5', 'years')).toMatch(/whole number of years/);
    expect(ageProblem('200', 'years')).toMatch(/up to 130/);
    expect(ageProblem('40', 'months')).toMatch(/up to 36/);
  });

  it('says when an age is estimated', () => {
    expect(ageText('1992-11-17', true, today)).toBe('34 years (estimated)');
    expect(ageText('1992-11-17', false, today)).toBe('34 years');
  });
});
