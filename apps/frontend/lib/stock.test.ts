import { describe, expect, it } from 'vitest';
import { countDifference, matchesFilter, signed, stockState, wholeNumber } from './stock';

const NOW = new Date('2026-11-05T09:00:00Z');
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

describe('stock on the shelf', () => {
  it('says when an item is out, low, expiring within 60 days, or holds expired stock', () => {
    expect(stockState({ quantity: 0, reorderLevel: 10 }, NOW)).toMatchObject({ out: true, low: false });
    expect(stockState({ quantity: 10, reorderLevel: 10 }, NOW)).toMatchObject({ out: false, low: true });
    expect(stockState({ quantity: 50, reorderLevel: 10, expiryDate: inDays(30) }, NOW)).toMatchObject({ expiringSoon: true, expired: 0 });
    expect(stockState({ quantity: 50, reorderLevel: 10, expiryDate: inDays(90) }, NOW).expiringSoon).toBe(false);
    // The server says how much has expired; without it, a passed expiry means all of it.
    expect(stockState({ quantity: 50, reorderLevel: 10, expiryDate: inDays(-1), expiredQuantity: 20 }, NOW).expired).toBe(20);
    expect(stockState({ quantity: 50, reorderLevel: 10, expiryDate: inDays(-1) }, NOW).expired).toBe(50);
  });

  it('filters by name and by state', () => {
    const items = [
      { name: 'Amoxicillin 500 mg', quantity: 5, reorderLevel: 10 },
      { name: 'Paracetamol 500 mg', quantity: 500, reorderLevel: 10, expiryDate: inDays(20) },
      { name: 'ORS sachets', quantity: 40, reorderLevel: 10, expiryDate: inDays(-3), expiredQuantity: 40 },
    ];
    const names = (filter: Parameters<typeof matchesFilter>[1], search = '') => items.filter((i) => matchesFilter(i, filter, search, NOW)).map((i) => i.name);
    expect(names('all', 'para')).toEqual(['Paracetamol 500 mg']);
    expect(names('low')).toEqual(['Amoxicillin 500 mg']);
    expect(names('expiring')).toEqual(['Paracetamol 500 mg']);
    expect(names('expired')).toEqual(['ORS sachets']);
  });
});

describe('what is typed', () => {
  it('takes whole numbers only, with commas', () => {
    expect(wholeNumber('1,000')).toBe(1000);
    expect(wholeNumber('0')).toBe(0);
    expect(wholeNumber('0', 1)).toBeNull();
    expect(wholeNumber('-5')).toBeNull();
    expect(wholeNumber('2.5')).toBeNull();
    expect(wholeNumber('')).toBeNull();
  });

  it('says what a count would change', () => {
    expect(countDifference(47, 50, 'tablets')).toBe('3 tablets fewer than recorded (50).');
    expect(countDifference(1060, 1000, 'tablets')).toBe('60 tablets more than recorded (1,000).');
    expect(countDifference(50, 50, 'tablets')).toBe('Matches what is recorded.');
    expect(countDifference(null, 50, 'tablets')).toBe('');
    expect(signed(1000)).toBe('+1,000');
    expect(signed(-20)).toBe('-20');
  });
});
