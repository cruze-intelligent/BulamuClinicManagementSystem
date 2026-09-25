import { describe, expect, it } from 'vitest';
import {
  DOSAGE_FORMS, ROUTES, FREQUENCIES,
  defaultDoseUnit, describeFrequency, doseText, draftProblems, draftToPayload, durationText, emptyDraft,
  formatPrescription, parseAmount, pluralUnit, suggestQuantity, type PrescriptionDraft,
} from './prescription';
import { MEDICINES_CATALOG, searchMedicinesCatalog } from './medicines-catalog';

const draft = (patch: Partial<PrescriptionDraft>): PrescriptionDraft => ({
  ...emptyDraft(), medication: 'Amoxicillin', strength: '500 mg', form: 'capsule', doseAmount: '1', doseUnit: 'capsule',
  route: 'PO', frequency: 'TDS', durationValue: '5', durationUnit: 'days', ...patch,
});

describe('reading a prescription', () => {
  it('writes a full prescription the way it appears on paper (same wording the printed PDF uses)', () => {
    expect(
      formatPrescription({
        medication: 'Amoxicillin', strength: '500 mg', form: 'capsule', dosage: '1 capsule', route: 'PO',
        frequency: 'TDS', duration: '5 days', quantity: 15, instructions: 'Take after food',
      })
    ).toEqual({
      title: 'Amoxicillin 500 mg capsule',
      sig: 'Take 1 capsule by mouth three times daily (TDS) for 5 days',
      quantity: 'Dispense: 15',
      instructions: 'Take after food',
    });
  });

  it('chooses the verb that fits the route', () => {
    const sig = (route: string) => formatPrescription({ medication: 'X', dosage: '1 unit', route, frequency: 'OD', duration: '' }).sig;
    expect(sig('TOP')).toBe('Apply 1 unit to the skin once daily (OD)');
    expect(sig('IM')).toBe('Give 1 unit by intramuscular injection once daily (OD)');
    expect(sig('EYE')).toBe('Instil 1 unit in the eye once daily (OD)');
  });

  it('reads prescriptions written before structured prescribing, keeping wording it does not know', () => {
    expect(formatPrescription({ medication: 'Coartem', dosage: '4 tablets', frequency: 'twice daily', duration: '3 days' })).toEqual({
      title: 'Coartem', sig: '4 tablets twice daily for 3 days', quantity: null, instructions: null,
    });
    expect(formatPrescription({ medication: 'Coartem', dosage: '4 tablets', frequency: 'bd', duration: '3 days' }).sig).toBe('4 tablets twice daily (BD) for 3 days');
    expect(describeFrequency('every other day')).toBe('every other day');
  });
});

describe('vocabulary', () => {
  it('has unique codes and plain-language phrases for every route and frequency', () => {
    expect(new Set(ROUTES.map((r) => r.code)).size).toBe(ROUTES.length);
    expect(new Set(FREQUENCIES.map((f) => f.code)).size).toBe(FREQUENCIES.length);
    for (const f of FREQUENCIES) expect(f.phrase.length).toBeGreaterThan(3);
    for (const r of ROUTES) expect(r.verb.length).toBeGreaterThan(2);
  });

  it('counts a dose in the unit that suits the form', () => {
    expect(defaultDoseUnit('tablet')).toBe('tablet');
    expect(defaultDoseUnit('syrup')).toBe('ml');
    expect(defaultDoseUnit('Cream')).toBe('application');
    expect(defaultDoseUnit('inhaler')).toBe('puff');
    expect(defaultDoseUnit('eye drops')).toBe('drop');
    for (const form of DOSAGE_FORMS) expect(defaultDoseUnit(form), form).toBeTruthy();
  });
});

describe('writing a dose and a duration', () => {
  it('reads amounts, fractions and decimals', () => {
    expect(parseAmount('2')).toBe(2);
    expect(parseAmount('0.5')).toBe(0.5);
    expect(parseAmount('1/2')).toBe(0.5);
    expect(parseAmount('1 1/2')).toBe(1.5);
    for (const bad of ['', 'abc', '0', '-1', '1/0']) expect(parseAmount(bad), bad).toBeNull();
  });

  it('makes units plural only when it should', () => {
    expect(doseText('1', 'tablet')).toBe('1 tablet');
    expect(doseText('2', 'tablet')).toBe('2 tablets');
    expect(doseText('1/2', 'tablet')).toBe('1/2 tablet');
    expect(doseText('5', 'ml')).toBe('5 ml');
    expect(doseText('1-2', 'capsule')).toBe('1-2 capsules');
    expect(pluralUnit('suppository', 2)).toBe('suppositories');
    expect(pluralUnit('IU', 5)).toBe('IU');
  });

  it('writes durations, singular for one', () => {
    expect(durationText('1', 'days')).toBe('1 day');
    expect(durationText('5', 'days')).toBe('5 days');
    expect(durationText('2', 'weeks')).toBe('2 weeks');
    expect(durationText('1', 'months')).toBe('1 month');
  });
});

describe('suggesting how many to dispense', () => {
  it('multiplies dose by doses per day by days', () => {
    expect(suggestQuantity(draft({}))).toBe(15); // 1 x 3 x 5
    expect(suggestQuantity(draft({ doseAmount: '2', frequency: 'BD', durationValue: '3' }))).toBe(12);
    expect(suggestQuantity(draft({ doseAmount: '1/2', frequency: 'OD', durationValue: '5' }))).toBe(3); // 2.5 rounds up
  });

  it('handles weeks, months, one-off doses and weekly doses', () => {
    expect(suggestQuantity(draft({ frequency: 'BD', durationValue: '2', durationUnit: 'weeks' }))).toBe(28);
    expect(suggestQuantity(draft({ frequency: 'OD', durationValue: '1', durationUnit: 'months' }))).toBe(30);
    expect(suggestQuantity(draft({ frequency: 'STAT', durationValue: '' }))).toBe(1);
    expect(suggestQuantity(draft({ frequency: 'WEEKLY', durationValue: '4', durationUnit: 'weeks' }))).toBe(4);
  });

  it('does not guess when it cannot be worked out', () => {
    expect(suggestQuantity(draft({ frequency: 'PRN' }))).toBeNull();
    expect(suggestQuantity(draft({ frequency: '' }))).toBeNull();
    expect(suggestQuantity(draft({ durationValue: '' }))).toBeNull();
    expect(suggestQuantity(draft({ doseAmount: 'a little' }))).toBeNull();
    expect(suggestQuantity(draft({ doseUnit: 'mg', doseAmount: '500' }))).toBeNull(); // a strength, not a countable dose
  });
});

describe('checking and saving a prescription line', () => {
  it('ignores a blank row and says exactly what is missing from an unfinished one', () => {
    expect(draftProblems(emptyDraft())).toEqual([]);
    expect(draftProblems(draft({ doseAmount: '', frequency: '', durationValue: '' }))).toEqual(['the dose (how much per time)', 'how often', 'for how long']);
    expect(draftProblems(draft({ route: '' }))).toEqual(['the route']);
    expect(draftProblems(draft({ quantity: '2.5' }))).toEqual(['a whole-number quantity']);
    expect(draftProblems(draft({}))).toEqual([]);
  });

  it('needs the prescriber to confirm an allergy warning before the line can be saved', () => {
    expect(draftProblems(draft({}), 1)).toEqual(['confirmation of the allergy warning']);
    expect(draftProblems(draft({ allergyOverride: true }), 1)).toEqual([]);
    expect(draftProblems(draft({}), 0)).toEqual([]);
    expect(draftProblems(emptyDraft(), 1)).toEqual([]);
  });

  it('sends the acknowledgement only when one was given', () => {
    expect(draftToPayload(draft({ allergyOverride: true })).allergyOverride).toBe(true);
    expect(draftToPayload(draft({})).allergyOverride).toBeUndefined();
  });

  it('does not need a duration for a single STAT dose', () => {
    expect(draftProblems(draft({ frequency: 'STAT', durationValue: '' }))).toEqual([]);
  });

  it('turns the form state into what is saved and sent', () => {
    expect(draftToPayload(draft({ quantity: '15', instructions: ' Take after food ', medicineId: 'med-1' }))).toEqual({
      medication: 'Amoxicillin', strength: '500 mg', form: 'capsule', dosage: '1 capsule', route: 'PO',
      frequency: 'TDS', duration: '5 days', quantity: 15, instructions: 'Take after food', medicineId: 'med-1',
    });
    const minimal = draftToPayload(draft({ strength: '', form: '', route: '' }));
    expect(minimal).toEqual({ medication: 'Amoxicillin', dosage: '1 capsule', frequency: 'TDS', duration: '5 days' });
  });

  it('saves a STAT dose with no duration', () => {
    expect(draftToPayload(draft({ frequency: 'STAT', durationValue: '' })).duration).toBe('');
  });

  it('reads back, in plain words, exactly what was entered', () => {
    const line = formatPrescription(draftToPayload(draft({ quantity: '15' })));
    expect(line.sig).toBe('Take 1 capsule by mouth three times daily (TDS) for 5 days');
    expect(line.quantity).toBe('Dispense: 15');
  });
});

describe('medicines reference list', () => {
  it('lists each medicine once, with a valid route and only forms the form can select', () => {
    const names = new Set<string>();
    const routes = new Set<string>(ROUTES.map((r) => r.code));
    for (const m of MEDICINES_CATALOG) {
      expect(names.has(m.name.toLowerCase()), `duplicate ${m.name}`).toBe(false);
      names.add(m.name.toLowerCase());
      expect(routes.has(m.route), `${m.name} route ${m.route}`).toBe(true);
      expect(m.variants.length, m.name).toBeGreaterThan(0);
      for (const variant of m.variants) {
        expect((DOSAGE_FORMS as readonly string[]).includes(variant.form), `${m.name}: form "${variant.form}"`).toBe(true);
        expect(variant.strength.trim(), m.name).not.toBe('');
      }
    }
  });

  it('finds a medicine by generic name or a brand people know', () => {
    const names = (q: string) => searchMedicinesCatalog(q).map((m) => m.name);
    expect(names('amoxi')[0]).toBe('Amoxicillin');
    expect(names('coartem')).toContain('Artemether/Lumefantrine');
    expect(names('panadol')).toContain('Paracetamol');
    expect(names('septrin')).toContain('Cotrimoxazole');
    expect(names('zzzz')).toEqual([]);
    expect(names('')).toEqual([]);
  });
});
