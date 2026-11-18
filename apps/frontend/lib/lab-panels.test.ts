import { describe, expect, it } from 'vitest';
import { blankValues, flagFor, labPanelFor, referenceText } from './lab-panels';
import { LAB_TESTS_CATALOG } from './lab-tests-catalog';

describe('lab results entered value by value', () => {
  it('has a template for the multi-value tests on the lab list, each named as the list names it', () => {
    for (const name of ['Complete blood count (CBC)', 'Renal function tests (urea, creatinine, electrolytes)', 'Liver function tests (LFTs)', 'Lipid profile', 'Urinalysis', 'Thyroid function tests (TFTs)']) {
      expect(labPanelFor(name), name).toBeTruthy();
      expect(LAB_TESTS_CATALOG.some((t) => t.name === name), `${name} on the lab list`).toBe(true);
    }
    expect(labPanelFor('Malaria RDT')).toBeUndefined();
  });

  it("fills in the patient's reference ranges, by sex where they differ", () => {
    const cbc = labPanelFor('Complete blood count (CBC)')!;
    const hb = (sex: string) => blankValues(cbc, sex).find((v) => v.name === 'Haemoglobin (HGB)')!;
    expect([hb('MALE').low, hb('MALE').high]).toEqual([13, 17]);
    expect([hb('FEMALE').low, hb('FEMALE').high]).toEqual([12, 15.5]);
    expect(blankValues(cbc, 'FEMALE').find((v) => v.name === 'WBC')).toMatchObject({ low: 4, high: 10, unit: 'x10^9/L', value: '' });
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
