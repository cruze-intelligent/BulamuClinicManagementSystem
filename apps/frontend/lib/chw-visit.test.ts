import { describe, expect, it } from 'vitest';
import { buildChwVisitSummary } from './chw-visit';

describe('buildChwVisitSummary', () => {
  it('reports no findings when nothing is checked', () => {
    const summary = buildChwVisitSummary([], []);
    expect(summary.hasDangerSign).toBe(false);
    expect(summary.symptomsText).toBe('None reported');
    expect(summary.diagnosis).toBe('Community household visit');
  });

  it('lists checked symptoms without flagging referral', () => {
    const summary = buildChwVisitSummary(['Fever', 'Cough'], []);
    expect(summary.hasDangerSign).toBe(false);
    expect(summary.symptomsText).toBe('Fever, Cough');
    expect(summary.diagnosis).toBe('Community household visit');
  });

  it('flags referral and prefixes danger signs when any are checked', () => {
    const summary = buildChwVisitSummary(['Fever'], ['Convulsions']);
    expect(summary.hasDangerSign).toBe(true);
    expect(summary.symptomsText).toBe('Fever, DANGER SIGN: Convulsions');
    expect(summary.diagnosis).toBe('Community visit - referral needed');
  });

  it('flags referral even with no accompanying symptoms', () => {
    const summary = buildChwVisitSummary([], ['Unconscious or very weak']);
    expect(summary.hasDangerSign).toBe(true);
    expect(summary.symptomsText).toBe('DANGER SIGN: Unconscious or very weak');
  });
});
