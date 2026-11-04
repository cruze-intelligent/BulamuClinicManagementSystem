import { describe, expect, it } from 'vitest';
import { monthLabel, paymentStatusLabel, periodText, receivedChange } from './platform-finances';

describe("the operator's finances page", () => {
  it('names months for headings and chart labels', () => {
    expect(monthLabel('2026-11', 'long')).toBe('November 2026');
    expect(monthLabel('2026-01', 'short')).toBe('Jan 26');
  });

  it('compares with last month only when last month had income', () => {
    expect(receivedChange(150000, 100000)).toBe(0.5);
    expect(receivedChange(50000, 100000)).toBe(-0.5);
    expect(receivedChange(100000, 0)).toBeNull();
    expect(receivedChange(0, 0)).toBe(0);
  });

  it('says what each payment state means in plain words', () => {
    expect(paymentStatusLabel('COMPLETED')).toBe('Received');
    expect(paymentStatusLabel('PENDING')).toBe('Not finished');
    expect(paymentStatusLabel('REVERSED')).toBe('Reversed');
  });

  it('shows the period paid for, in Kampala days', () => {
    expect(periodText('2026-10-01T21:00:00Z', '2026-10-31T21:00:00Z')).toBe('2 Oct 2026 - 1 Nov 2026');
    expect(periodText(null, '2026-10-31T09:00:00Z')).toBe('until 31 Oct 2026');
    expect(periodText(null, null)).toBe('-');
  });
});
