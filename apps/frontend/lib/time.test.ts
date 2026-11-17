import { afterEach, describe, expect, it } from 'vitest';
import { clockOffset, formatDate, formatDateTime, formatTime, kampalaDay, rememberServerTime, serverNow } from './time';

afterEach(() => localStorage.clear());

describe('time, the same on every device', () => {
  it('shows every moment in Kampala time, whatever the device is set to', () => {
    const moment = '2026-11-17T21:30:00Z'; // 00:30 on the 18th in Kampala
    expect(formatDate(moment)).toBe('18 Nov 2026');
    expect(formatTime(moment)).toBe('00:30');
    expect(formatDateTime(moment)).toBe('18 Nov 2026, 00:30');
    expect(kampalaDay(moment)).toBe('2026-11-18');
  });

  it("corrects this device's clock by the server's, allowing for the time the reply took", () => {
    expect(clockOffset()).toBe(0);
    // The device thinks it is 10:00:00; the server, answering halfway through a 2-second request, said 10:05:00.
    const sent = new Date('2026-11-17T10:00:00Z').getTime();
    rememberServerTime('2026-11-17T10:05:01Z', sent, sent + 2000);
    expect(clockOffset()).toBe(300_000);
    expect(Math.abs(serverNow().getTime() - (Date.now() + 300_000))).toBeLessThan(50);
    // A reply that took too long, or makes no sense, changes nothing.
    rememberServerTime('2026-11-17T12:00:00Z', sent, sent + 120_000);
    rememberServerTime('not a time', sent, sent + 100);
    expect(clockOffset()).toBe(300_000);
  });
});
