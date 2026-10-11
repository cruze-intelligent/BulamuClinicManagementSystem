import { describe, expect, it } from 'vitest';
import { isLapsed, SUBSCRIPTION_ENDED_MESSAGE, SubscriptionRequiredError } from './subscription-state';

const now = new Date('2026-10-11T08:00:00Z').getTime();
const base = { clinicId: 'clinic-1', trialEndsAt: '2026-10-15T08:00:00Z' };

describe('whether this device lets a save through', () => {
  it('allows saving during the trial and a paid month', () => {
    expect(isLapsed({ ...base, status: 'TRIALING' }, now)).toBe(false);
    expect(isLapsed({ ...base, status: 'ACTIVE', currentPeriodEnd: '2026-11-01T00:00:00Z' }, now)).toBe(false);
    expect(isLapsed({ ...base, status: 'ACTIVE', currentPeriodEnd: null }, now)).toBe(false);
  });

  it('closes saving once the trial or paid month has ended, even before the server has said so', () => {
    expect(isLapsed({ ...base, status: 'TRIALING', trialEndsAt: '2026-10-10T08:00:00Z' }, now)).toBe(true);
    expect(isLapsed({ ...base, status: 'ACTIVE', currentPeriodEnd: '2026-10-01T00:00:00Z' }, now)).toBe(true);
    expect(isLapsed({ ...base, status: 'PAST_DUE' }, now)).toBe(true);
    expect(isLapsed({ ...base, status: 'CANCELLED' }, now)).toBe(true);
  });

  it('never blocks when it knows nothing (the server still decides)', () => {
    expect(isLapsed(null, now)).toBe(false);
  });

  it('tells staff what happened and what to do', () => {
    const error = new SubscriptionRequiredError();
    expect(error.message).toBe(SUBSCRIPTION_ENDED_MESSAGE);
    expect(error.message).toMatch(/can still be viewed/);
    expect(error.message).toMatch(/Billing page/);
  });
});
