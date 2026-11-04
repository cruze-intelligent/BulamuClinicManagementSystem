import { describe, expect, it } from 'vitest';
import { allowanceText, changeRows, detailEdits, detailProblem, formFrom, type FacilityDetails } from './facility-details';

const CURRENT: FacilityDetails = {
  name: 'Mbarara Family Clinic', facilityType: 'CLINIC', phone: '0772 111 222', address: 'Plot 4, High Street', district: 'Mbarara', subCounty: null, parish: null,
};

describe('facility details', () => {
  it('sends only what changed, tidied the way it is stored', () => {
    const form = formFrom(CURRENT);
    expect(detailEdits(form, CURRENT)).toEqual({});
    expect(detailEdits({ ...form, name: '  Mbarara  Family Clinic ', subCounty: '  ' }, CURRENT)).toEqual({});
    expect(detailEdits({ ...form, name: 'Mbarara Hospital', district: '', parish: 'Ruharo' }, CURRENT)).toEqual({ name: 'Mbarara Hospital', district: '', parish: 'Ruharo' });
  });

  it('says what is wrong before anything is sent', () => {
    const form = formFrom(CURRENT);
    expect(detailProblem(form)).toBeNull();
    expect(detailProblem({ ...form, name: ' ' })).toBe('Enter the facility name');
    expect(detailProblem({ ...form, name: 'AB' })).toBe('The name must be at least 3 characters');
    expect(detailProblem({ ...form, address: '' })).toBe('Enter the address');
    expect(detailProblem({ ...form, phone: '0772' })).toMatch(/9 to 15 digits/);
    expect(detailProblem({ ...form, phone: 'ring us' })).toMatch(/9 to 15 digits/);
    expect(detailProblem({ ...form, phone: '+256 (772) 111-222' })).toBeNull();
  });

  it('shows a change as before and after, with readable types and blanks', () => {
    expect(changeRows({ changes: { facilityType: { from: 'CLINIC', to: 'HEALTH_CENTRE_III' }, parish: { from: 'Ruharo', to: null } } })).toEqual([
      ['Type', 'Clinic', 'Health Centre III'], ['Parish', 'Ruharo', '(none)'],
    ]);
  });

  it('explains how many changes are left, and that Bulamu checks the rest', () => {
    expect(allowanceText({ limit: 3, windowDays: 365, used: 0, remaining: 3, nextFreeAt: null })).toMatch(/^You can make 3 more changes yourself/);
    expect(allowanceText({ limit: 3, windowDays: 365, used: 2, remaining: 1, nextFreeAt: null })).toMatch(/^You can make 1 more change yourself/);
    const full = allowanceText({ limit: 3, windowDays: 365, used: 3, remaining: 0, nextFreeAt: '2027-03-01T09:00:00Z' });
    expect(full).toBe('Your facility has changed its details 3 times in the last 12 months, so Bulamu checks each further change until 1 Mar 2027. Say why the details are changing.');
  });
});
