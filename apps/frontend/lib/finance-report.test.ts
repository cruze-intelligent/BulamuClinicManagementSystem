import { describe, expect, it } from 'vitest';
import { categoriesFor, periodDates, periodProblem, reportFileName, reportQuery } from './finance-report';

describe('financial report choices', () => {
  it('works out the periods from today in Kampala, across a new year too', () => {
    expect(periodDates('this-month', '2026-11-04')).toEqual({ from: '2026-11-01', to: '2026-11-04' });
    expect(periodDates('last-month', '2026-11-04')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodDates('last-month', '2027-01-15')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(periodDates('last-month', '2028-03-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' }); // a leap year
    expect(periodDates('this-year', '2026-11-04')).toEqual({ from: '2026-01-01', to: '2026-11-04' });
  });

  it('says what is wrong with chosen dates', () => {
    expect(periodProblem('2026-10-01', '2026-10-31')).toBeNull();
    expect(periodProblem('2026-10-31', '2026-10-01')).toBe('The end date is before the start date.');
    expect(periodProblem('2026-01-01', '2026-12-31')).toBeNull(); // a whole year is fine
    expect(periodProblem('2025-01-01', '2026-01-01')).toBeNull(); // 366 days, the most allowed
    expect(periodProblem('2025-01-01', '2026-01-02')).toBe('A report covers at most one year - choose a shorter period.');
    expect(periodProblem('', '2026-10-01')).toBe('Choose both dates.');
  });

  it('offers categories only where a section has them', () => {
    expect(categoriesFor('income').map((c) => c.value)).toContain('MOBILE_MONEY');
    expect(categoriesFor('billed').map((c) => c.value)).toContain('LAB');
    expect(categoriesFor('expenses').map((c) => c.value)).toContain('RENT');
    expect(categoriesFor('all')).toEqual([]);
    expect(categoriesFor('outstanding')).toEqual([]);
  });

  it('asks the server for exactly what was chosen, and names the file as the server does', () => {
    const everything = { from: '2026-10-01', to: '2026-10-31', section: 'all' as const, category: '', format: 'pdf' as const };
    expect(reportQuery(everything)).toBe('from=2026-10-01&to=2026-10-31&format=pdf');
    expect(reportFileName(everything)).toBe('financial-report-all-2026-10-01-to-2026-10-31.pdf');

    const rent = { ...everything, section: 'expenses' as const, category: 'RENT', format: 'csv' as const };
    expect(reportQuery(rent)).toBe('from=2026-10-01&to=2026-10-31&format=csv&section=expenses&category=RENT');
    expect(reportFileName(rent)).toBe('financial-report-expenses-rent-2026-10-01-to-2026-10-31.csv');

    // A category left over from another section is dropped, not sent.
    expect(reportQuery({ ...rent, section: 'income' })).toBe('from=2026-10-01&to=2026-10-31&format=csv&section=income');
    expect(reportFileName({ ...rent, section: 'billed', category: 'MEDICINE' })).toBe('financial-report-billed-medicine-2026-10-01-to-2026-10-31.csv');
  });
});
