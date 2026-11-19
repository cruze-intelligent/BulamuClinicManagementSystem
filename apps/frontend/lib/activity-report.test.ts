import { describe, expect, it } from 'vitest';
import { activityDefaults, activityQueryString, kampalaToday } from './activity-report';

describe('the daily and weekly report', () => {
  it('starts from the last 7 days, the last 8 weeks from a Monday, or this year so far', () => {
    expect(activityDefaults('day', '2026-11-19')).toMatchObject({ from: '2026-11-13', to: '2026-11-19' });
    // Thursday 19 November: its week began Monday 16 November; eight weeks go back to Monday 28 September.
    expect(activityDefaults('week', '2026-11-19')).toMatchObject({ from: '2026-09-28', to: '2026-11-19' });
    expect(activityDefaults('month', '2026-11-19')).toMatchObject({ from: '2026-01-01', to: '2026-11-19' });
  });

  it('asks only for the patients chosen', () => {
    expect(activityQueryString({ period: 'week', from: '2026-11-01', to: '2026-11-19', sex: '', ageGroup: '' })).toBe('period=week&from=2026-11-01&to=2026-11-19');
    expect(activityQueryString({ period: 'day', from: '2026-11-19', to: '2026-11-19', sex: 'FEMALE', ageGroup: 'under-5' })).toBe('period=day&from=2026-11-19&to=2026-11-19&sex=FEMALE&ageGroup=under-5');
  });

  it('counts a Kampala day, which begins at 21:00 UTC', () => {
    expect(kampalaToday(new Date('2026-11-18T21:30:00Z'))).toBe('2026-11-19');
  });
});
