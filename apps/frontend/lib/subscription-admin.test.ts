import { describe, expect, it } from 'vitest';
import { cashProblem, graceCandidate, graceStatus, shillings, type BillingFacility, type CashForm } from './subscription-admin';

const NOW = new Date('2026-11-07T09:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(NOW + days * DAY).toISOString();

const facility = (subscription: Partial<NonNullable<BillingFacility['subscription']>> = {}): BillingFacility => ({
  id: 'c1', name: 'Gulu Family Clinic', facilityCode: 'BLM-GU04',
  subscription: { status: 'ACTIVE', amount: 100000, currency: 'UGX', trialEndsAt: at(-60), currentPeriodEnd: at(10), lastPaymentAt: at(-20), graceDays: 0, graceFrom: null, ...subscription },
});
const form = (patch: Partial<CashForm> = {}): CashForm => ({ facilityId: 'c1', months: '1', amount: '100,000', paidBy: 'Okello James', reference: '', ...patch });

describe('recording cash', () => {
  it('reads shillings typed with commas or spaces, and nothing else', () => {
    expect(shillings('200,000')).toBe(200000);
    expect(shillings(' 200 000 ')).toBe(200000);
    expect(shillings('200k')).toBeNaN();
    expect(shillings('')).toBeNaN();
  });

  it('checks the cash counted against what the months cost', () => {
    expect(cashProblem(form(), facility())).toBeNull();
    expect(cashProblem(form({ months: '3', amount: '300000' }), facility())).toBeNull();
    expect(cashProblem(form(), undefined)).toBe('Choose the facility that paid');
    expect(cashProblem(form({ amount: '' }), facility())).toBe('Enter the amount of cash received');
    expect(cashProblem(form({ months: '2', amount: '100,000' }), facility())).toBe('2 months at UGX 100,000 is UGX 200,000 - check the cash counted');
    expect(cashProblem(form({ paidBy: ' ' }), facility())).toBe('Enter the name of the person who handed over the cash');
  });
});

describe('grace days', () => {
  it('are for paid facilities whose period has ended, or that are already in grace', () => {
    expect(graceCandidate(facility({ status: 'PAST_DUE', currentPeriodEnd: at(-3) }), NOW)).toBe(true);
    expect(graceCandidate(facility({ status: 'ACTIVE', currentPeriodEnd: at(-0.1) }), NOW)).toBe(true);
    expect(graceCandidate(facility({ status: 'ACTIVE', currentPeriodEnd: at(4), graceDays: 3, graceFrom: at(-3) }), NOW)).toBe(true);
    expect(graceCandidate(facility(), NOW)).toBe(false); // still paid
    expect(graceCandidate(facility({ status: 'PAST_DUE', lastPaymentAt: null }), NOW)).toBe(false); // a trial that ran out
    expect(graceCandidate(facility({ status: 'CANCELLED', currentPeriodEnd: at(-3) }), NOW)).toBe(false);
  });

  it('say where the facility stands', () => {
    expect(graceStatus(facility({ status: 'PAST_DUE', currentPeriodEnd: at(-3) }), NOW)).toBe('Paid period ended 4 Nov 2026');
    expect(graceStatus(facility({ currentPeriodEnd: at(4), graceDays: 3, graceFrom: at(-3) }), NOW)).toBe('In grace until 11 Nov 2026 - 3 of 7 days given');
    expect(graceStatus(facility({ status: 'PAST_DUE', currentPeriodEnd: at(-1), graceDays: 7, graceFrom: at(-8) }), NOW)).toBe('Grace ran out 6 Nov 2026 - 7 of 7 days given');
  });
});
