import { describe, expect, it } from 'vitest';
import {
  compactNumber, engagementRank, formatBytes, formatChange, formatPercent, formatUptime, humanize, niceMax, shortDay, timeAgo, totalOf,
} from './analytics-format';

describe('analytics formatting', () => {
  it('shortens big numbers', () => {
    expect(compactNumber(950)).toBe('950');
    expect(compactNumber(12_400)).toBe('12.4k');
    expect(compactNumber(2_500_000)).toBe('2.5M');
  });

  it('describes change against the previous period, and says nothing without a baseline', () => {
    expect(formatChange(0.5)).toBe('+50%');
    expect(formatChange(-0.083)).toBe('-8%');
    expect(formatChange(0)).toBe('no change');
    expect(formatChange(null)).toBeNull();
    expect(formatPercent(0.456)).toBe('46%');
    expect(formatPercent(null)).toBe('-');
  });

  it('formats sizes and uptime', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe('5 GB');
    expect(formatUptime(90)).toBe('1m');
    expect(formatUptime(3 * 3600 + 120)).toBe('3h 2m');
    expect(formatUptime(2 * 86400 + 5 * 3600)).toBe('2d 5h');
  });

  it('says how long ago something happened', () => {
    const now = new Date('2026-09-26T12:00:00Z');
    expect(timeAgo(null, now)).toBe('never');
    expect(timeAgo('2026-09-26T11:59:40Z', now)).toBe('just now');
    expect(timeAgo('2026-09-26T11:30:00Z', now)).toBe('30 min ago');
    expect(timeAgo('2026-09-26T11:00:00Z', now)).toBe('1 hour ago');
    expect(timeAgo('2026-09-23T12:00:00Z', now)).toBe('3 days ago');
    expect(timeAgo('2026-05-01T12:00:00Z', now)).toBe('4 months ago');
  });

  it('labels days without timezone drift', () => {
    expect(shortDay('2026-09-01')).toBe('1 Sep');
    expect(shortDay('2027-01-31')).toBe('31 Jan');
  });

  it('picks tidy axis maxima', () => {
    expect(niceMax(0)).toBe(4);
    expect(niceMax(3)).toBe(4);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(130)).toBe(200);
    expect(niceMax(4300)).toBe(5000);
  });

  it('totals series and orders engagement from healthiest to least', () => {
    expect(totalOf([{ date: 'a', value: 2 }, { date: 'b', value: 3 }])).toBe(5);
    expect(['NEVER_USED', 'ACTIVE', 'DORMANT', 'QUIET'].sort((a, b) => engagementRank(a) - engagementRank(b))).toEqual(['ACTIVE', 'QUIET', 'DORMANT', 'NEVER_USED']);
    expect(humanize('PAST_DUE')).toBe('Past due');
  });
});
