import { describe, expect, it } from 'vitest';
import { listedPrice, procedureChoices, suggestedServices, type ServicePrice } from './price-list';

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

describe('procedures offered at a visit', () => {
  it("offers the facility's priced procedures first, finds one by its usual shorthand, and the common ones too", () => {
    const list: ServicePrice[] = [{ id: 'p', kind: 'PROCEDURE', name: 'Incision and drainage', price: 30000 }, { id: 'l', kind: 'LAB', name: 'Ear swab', price: 5000 }];
    expect(procedureChoices(list, '')[0]).toEqual({ name: 'Incision and drainage', price: 30000 });
    expect(procedureChoices(list, 'I&D').map((c) => c.name)).toEqual(['Incision and drainage']);
    expect(procedureChoices(list, 'ear').map((c) => c.name)).toEqual(['Ear syringing']);
    expect(procedureChoices([], 'circum')).toEqual([{ name: 'Circumcision', price: null }]);
  });
});
