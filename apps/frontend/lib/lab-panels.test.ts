import { describe, expect, it } from 'vitest';
import { LAB_PANELS, blankValues, flagFor, labPanelFor, referenceText } from './lab-panels';
import { LAB_TESTS_CATALOG } from './lab-tests-catalog';

describe('lab results entered value by value', () => {
  it('has a template for the multi-value tests on the lab list, each named as the list names it', () => {
    for (const name of ['Complete blood count (CBC)', 'Renal function tests (urea, creatinine, electrolytes)', 'Liver function tests (LFTs)', 'Lipid profile', 'Urinalysis', 'Thyroid function tests (TFTs)']) {
      expect(labPanelFor(name), name).toBeTruthy();
      expect(LAB_TESTS_CATALOG.some((t) => t.name === name), `${name} on the lab list`).toBe(true);
    }
    expect(labPanelFor('Malaria RDT')).toBeUndefined();
  });

  it('names every template exactly as the lab list does, so a test ordered finds its template', () => {
    for (const panel of LAB_PANELS) expect(LAB_TESTS_CATALOG.some((t) => t.name === panel.test), panel.test).toBe(true);
  });

  it("leaves a woman's cycle-dependent hormone range for the lab to write, instead of offering a man's", () => {
    const fsh = labPanelFor('Follicle stimulating hormone (FSH)')!;
    expect(blankValues(fsh, 'FEMALE')[0]).toMatchObject({ low: null, high: null, unit: 'IU/L' });
    expect(blankValues(fsh, 'MALE')[0]).toMatchObject({ low: 1.5, high: 12.4 });
    expect(blankValues(labPanelFor('Prolactin')!, 'FEMALE')[0]).toMatchObject({ low: 4.8, high: 23.3 });
    expect(referenceText(blankValues(labPanelFor('CA 125')!, 'FEMALE')[0])).toBe('< 35');
  });

  it("fills in the patient's reference ranges, by sex where they differ", () => {
    const cbc = labPanelFor('Complete blood count (CBC)')!;
    // The facility's 3-part analyser: its units and ranges.
    const hb = (sex: string) => blankValues(cbc, sex).find((v) => v.name === 'HGB')!;
    expect([hb('MALE').low, hb('MALE').high]).toEqual([13, 17.5]);
    expect([hb('FEMALE').low, hb('FEMALE').high]).toEqual([11.5, 15]);
    expect(blankValues(cbc, 'FEMALE').find((v) => v.name === 'WBC')).toMatchObject({ low: 3.5, high: 9.5, unit: '10^3/uL', value: '' });
    expect(blankValues(cbc, 'FEMALE').find((v) => v.name === 'PLT')).toMatchObject({ low: 125, high: 350 });
    expect(cbc.parameters.map((p) => p.name).slice(0, 7)).toEqual(['WBC', 'Lym%', 'Gran%', 'Mid%', 'Lym#', 'Gran#', 'Mid#']);
  });

  it('flags a value High or Low against its range, and a word reading that is not the normal one', () => {
    expect(flagFor('9.6', 1.71, 8.55)).toBe('H');
    expect(flagFor('0.01', 0.02, 0.1)).toBe('L');
    expect(flagFor('4.21', 3.5, 5.1)).toBeNull();
    expect(flagFor('<0.5', 1, 5)).toBe('L');
    expect(flagFor('6.1', undefined, 5.2)).toBe('H');
    expect(flagFor('Positive (++)', null, null, 'Negative')).toBe('A');
    expect(flagFor('negative', null, null, 'Negative')).toBeNull();
    expect(flagFor('', 1, 2)).toBeNull();
  });

  it('writes the reference as a report prints it', () => {
    expect(referenceText({ low: 3.5, high: 5.1, normal: null })).toBe('3.5 - 5.1');
    expect(referenceText({ low: null, high: 5.2, normal: null })).toBe('< 5.2');
    expect(referenceText({ low: 1, high: null, normal: null })).toBe('> 1');
    expect(referenceText({ low: null, high: null, normal: 'Negative' })).toBe('Negative');
  });
});
