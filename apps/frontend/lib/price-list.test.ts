import { describe, expect, it } from 'vitest';
import { listedPrice, suggestedServices, type ServicePrice } from './price-list';

const prices: ServicePrice[] = [
  { id: '1', kind: 'CONSULTATION', name: 'General consultation', price: 10000 },
  { id: '2', kind: 'LAB', name: 'Malaria RDT', price: 5000 },
];

describe('the price list', () => {
  it('finds a listed price by kind and name, in any letter case', () => {
    expect(listedPrice(prices, 'LAB', ' malaria rdt ')).toBe(5000);
    expect(listedPrice(prices, 'IMAGING', 'Malaria RDT')).toBeNull();
    expect(listedPrice(prices, 'LAB', '')).toBeNull();
  });

  it('offers names to start from for each kind of charge', () => {
    expect(suggestedServices('LAB')).toContain('Malaria RDT');
    expect(suggestedServices('IMAGING')).toContain('Abdominal ultrasound');
    expect(suggestedServices('PROCEDURE')).toContain('Wound dressing');
    expect(suggestedServices('ADMISSION', ['Female Ward'])).toEqual(['Female Ward - ward stay (per night)']);
    expect(suggestedServices('MEDICINE')).toEqual([]);
  });
});
