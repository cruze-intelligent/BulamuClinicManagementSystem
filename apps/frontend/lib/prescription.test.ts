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
      order: 'P.O Amoxicillin 500mg TDS x 5 days',
      details: 'Capsule',
      title: 'Amoxicillin 500 mg capsule',
      sig: 'Take 1 capsule by mouth three times daily (TDS) for 5 days',
      quantity: 'Dispense: 15',
      instructions: 'Take after food',
    });
  });

  it('chooses the verb that fits the route', () => {
    const sig = (route: string) => formatPrescription({ medication: 'X', dosage: '1 unit', route, frequency: 'OD', duration: '' }).sig;
    expect(sig('TOP')).toBe('Apply 1 unit to the skin once daily (OD)');
    // Injections are given by staff: the patient's directions never say "Give".
    expect(sig('IM')).toBe('1 unit by intramuscular injection once daily (OD)');
    expect(sig('EYE')).toBe('Instil 1 unit in the eye once daily (OD)');
  });

  it('reads prescriptions written before structured prescribing, keeping wording it does not know', () => {
    expect(formatPrescription({ medication: 'Coartem', dosage: '4 tablets', frequency: 'twice daily', duration: '3 days' })).toEqual({
      order: 'Coartem 4 tablets twice daily x 3 days', details: null, title: 'Coartem', sig: '4 tablets twice daily for 3 days', quantity: null, instructions: null,
    });
    expect(formatPrescription({ medication: 'Coartem', dosage: '4 tablets', frequency: 'bd', duration: '3 days' }).sig).toBe('4 tablets twice daily (BD) for 3 days');
    expect(describeFrequency('every other day')).toBe('every other day');
  });
});

describe('the prescription line, as prescribers write it', () => {
  // The same lines the printed prescription uses (apps/backend/test/clinical.test.ts).
  const order = (rx: Parameters<typeof formatPrescription>[0]) => formatPrescription(rx).order;
  it('puts route, drug and dose, frequency and duration in that order', () => {
    expect(order({ medication: 'Artesunate', strength: '60 mg', form: 'injection', dosage: '120 mg', route: 'IV', frequency: 'Q12H', duration: '1 day' })).toBe('I.V Artesunate 120mg 12hrly x 1 day');
    expect(order({ medication: 'Amoxicillin', strength: '500 mg', form: 'capsule', dosage: '1 capsule', route: 'PO', frequency: 'TDS', duration: '5 days' })).toBe('P.O Amoxicillin 500mg TDS x 5 days');
    expect(order({ medication: 'Paracetamol', strength: '500 mg', form: 'tablet', dosage: '2 tablets', route: 'PO', frequency: 'TDS', duration: '3 days' })).toBe('P.O Paracetamol 1g (2 tablets) TDS x 3 days');
    expect(order({ medication: 'Paracetamol', strength: '500 mg', form: 'tablet', dosage: '1/2 tablet', route: 'PO', frequency: 'PRN', duration: '3 days' })).toBe('P.O Paracetamol 250mg (1/2 tablet) PRN x 3 days');
    expect(order({ medication: 'Amoxicillin', strength: '125 mg/5 ml', form: 'suspension', dosage: '5 ml', route: 'PO', frequency: 'TDS', duration: '5 days' })).toBe('P.O Amoxicillin 125mg/5ml 5ml TDS x 5 days');
    expect(order({ medication: 'Artemether', strength: '80 mg/ml', form: 'injection', dosage: '160 mg', route: 'IM', frequency: 'STAT', duration: '' })).toBe('I.M Artemether 160mg STAT');
    expect(order({ medication: 'Normal saline 0.9%', form: 'infusion', dosage: '1000 ml', route: 'IV', frequency: 'Q8H', duration: '1 day' })).toBe('I.V Normal saline 0.9% 1000ml 8hrly x 1 day');
    expect(order({ medication: 'Normal saline', strength: '0.9%', form: 'infusion', dosage: '1000 ml', route: 'IV', frequency: 'Q8H', duration: '1 day' })).toBe('I.V Normal saline 0.9% 1000ml 8hrly x 1 day');
    expect(order({ medication: "Ringer's lactate", strength: 'compound sodium lactate', form: 'infusion', dosage: '500 ml', route: 'IV', frequency: 'STAT', duration: '' })).toBe("I.V Ringer's lactate 500ml STAT");
    expect(order({ medication: 'Hydralazine', strength: '20 mg/ml', form: 'injection', dosage: '5 mg', route: 'IV', frequency: 'STAT', duration: '' })).toBe('I.V Hydralazine 5mg STAT');
  });
});

describe('vocabulary', () => {
  it('has unique codes and plain-language phrases for every route and frequency', () => {
    expect(new Set(ROUTES.map((r) => r.code)).size).toBe(ROUTES.length);
    expect(new Set(FREQUENCIES.map((f) => f.code)).size).toBe(FREQUENCIES.length);
    for (const f of FREQUENCIES) expect(f.phrase.length).toBeGreaterThan(3);
    for (const r of ROUTES) expect(r.abbr.length).toBeGreaterThan(1);
    expect(ROUTES.map((r) => r.verb)).not.toContain('Give');
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

  it('reads back exactly what was entered, as a prescription line and in plain words', () => {
    const line = formatPrescription(draftToPayload(draft({ quantity: '15' })));
    expect(line.order).toBe('P.O Amoxicillin 500mg TDS x 5 days');
    expect(line.sig).toBe('Take 1 capsule by mouth three times daily (TDS) for 5 days');
    expect(line.quantity).toBe('Dispense: 15');
  });
});

describe('medicines reference list', () => {
  it('has the IV fluids and the drugs clinicians asked for, each strength given by the right route', () => {
    const find = (name: string) => MEDICINES_CATALOG.find((m) => m.name === name)!;
    for (const name of ['Normal saline', 'Dextrose', "Ringer's lactate", 'Hydralazine', 'Labetalol']) expect(find(name), name).toBeTruthy();
    expect(find('Hydralazine').variants.map((x) => x.route ?? find('Hydralazine').route)).toEqual(['IV', 'PO', 'PO']);
    expect(searchMedicinesCatalog('ringers')[0].name).toBe("Ringer's lactate");
    expect(searchMedicinesCatalog('normal saline')[0].name).toBe('Normal saline');
    const routes = new Set<string>(ROUTES.map((r) => r.code));
    for (const m of MEDICINES_CATALOG) for (const x of m.variants) if (x.route) expect(routes.has(x.route), `${m.name} ${x.form}`).toBe(true);
  });


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
