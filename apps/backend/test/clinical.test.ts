import { describe, expect, it } from 'vitest';
import {
  classifyHmisCondition,
  describeFrequency,
  formatPrescriptionLine,
  normalizeDiagnoses,
  normalizePrescriptions,
  primaryDiagnosisText,
  rankDiagnoses,
} from '../src/lib/clinical';

describe('normalizeDiagnoses', () => {
  it('turns a plain diagnosis string (older clients) into one uncoded primary diagnosis', () => {
    const result = normalizeDiagnoses(undefined, '  Malaria  ');
    expect(result).toEqual({
      ok: true,
      value: [{ icd10Code: null, description: 'Malaria', type: 'PRIMARY', certainty: 'CONFIRMED', notes: null }],
    });
  });

  it('requires at least one diagnosis', () => {
    expect(normalizeDiagnoses(undefined, '')).toMatchObject({ ok: false });
    expect(normalizeDiagnoses(undefined, undefined)).toMatchObject({ ok: false });
    expect(normalizeDiagnoses([], 'ignored')).toMatchObject({ ok: false });
  });

  it('accepts coded diagnoses, upper-cases the code and keeps certainty and notes', () => {
    const result = normalizeDiagnoses([
      { icd10Code: 'b54', description: 'Malaria, unspecified', type: 'PRIMARY', certainty: 'PROVISIONAL', notes: ' RDT pending ' },
      { icd10Code: 'D64.9', description: 'Anaemia', type: 'SECONDARY' },
    ]);
    expect(result.ok && result.value).toEqual([
      { icd10Code: 'B54', description: 'Malaria, unspecified', type: 'PRIMARY', certainty: 'PROVISIONAL', notes: 'RDT pending' },
      { icd10Code: 'D64.9', description: 'Anaemia', type: 'SECONDARY', certainty: 'CONFIRMED', notes: null },
    ]);
  });

  it('always yields exactly one primary: the first marked, else the first listed, listed first', () => {
    const noneMarked = normalizeDiagnoses([{ description: 'A' }, { description: 'B' }]);
    expect(noneMarked.ok && noneMarked.value.map((d) => [d.description, d.type])).toEqual([['A', 'PRIMARY'], ['B', 'SECONDARY']]);

    const twoMarked = normalizeDiagnoses([{ description: 'A', type: 'SECONDARY' }, { description: 'B', type: 'PRIMARY' }, { description: 'C', type: 'PRIMARY' }]);
    expect(twoMarked.ok && twoMarked.value.map((d) => [d.description, d.type])).toEqual([['B', 'PRIMARY'], ['A', 'SECONDARY'], ['C', 'SECONDARY']]);
  });

  it('rejects malformed codes, unknown certainty and over-long text with a message that says what is wrong', () => {
    expect(normalizeDiagnoses([{ description: 'X', icd10Code: 'malaria' }])).toMatchObject({ ok: false, error: expect.stringContaining('not a valid ICD-10 code') });
    expect(normalizeDiagnoses([{ description: 'X', icd10Code: 'B5' }])).toMatchObject({ ok: false });
    expect(normalizeDiagnoses([{ description: 'X', certainty: 'MAYBE' }])).toMatchObject({ ok: false, error: expect.stringContaining('certainty') });
    expect(normalizeDiagnoses([{ description: 'x'.repeat(201) }])).toMatchObject({ ok: false });
    expect(normalizeDiagnoses([{ icd10Code: 'B54' }])).toMatchObject({ ok: false, error: expect.stringContaining('needs a description') });
    expect(normalizeDiagnoses('Malaria' as any)).toMatchObject({ ok: false });
  });

  it('caps the number of diagnoses', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ description: `D${i}` }));
    expect(normalizeDiagnoses(many)).toMatchObject({ ok: false });
  });

  it('reports the primary diagnosis text for the legacy column', () => {
    expect(primaryDiagnosisText([{ description: 'B', type: 'SECONDARY' }, { description: 'A', type: 'PRIMARY' }])).toBe('A');
  });
});

describe('normalizePrescriptions', () => {
  it('treats a missing list as empty and drops blank rows', () => {
    expect(normalizePrescriptions(undefined)).toEqual({ ok: true, value: [] });
    const result = normalizePrescriptions([{ medication: '  ' }, { medication: 'Coartem', dosage: '4 tablets', frequency: 'BD', duration: '3 days' }]);
    expect(result.ok && result.value).toHaveLength(1);
  });

  it('keeps only known fields - nothing else can reach the database', () => {
    const result = normalizePrescriptions([{ medication: 'Amoxicillin', consultationId: 'someone-elses', id: 'x', clinicId: 'y', role: 'ADMIN' }]);
    expect(result.ok && Object.keys(result.value[0]).sort()).toEqual(
      ['dosage', 'duration', 'form', 'frequency', 'instructions', 'medication', 'medicineId', 'quantity', 'route', 'strength'].sort()
    );
  });

  it('still accepts the original free-text shape, however it is worded', () => {
    const result = normalizePrescriptions([{ medication: 'Coartem', dosage: '4 tablets', frequency: 'twice daily', duration: '3 days' }]);
    expect(result.ok && result.value[0]).toMatchObject({ medication: 'Coartem', dosage: '4 tablets', frequency: 'twice daily', duration: '3 days', quantity: null, route: null });
  });

  it('validates quantity as a whole number of at least one', () => {
    expect(normalizePrescriptions([{ medication: 'X', quantity: '15' }])).toMatchObject({ ok: true });
    expect(normalizePrescriptions([{ medication: 'X', quantity: 0 }])).toMatchObject({ ok: false });
    expect(normalizePrescriptions([{ medication: 'X', quantity: -3 }])).toMatchObject({ ok: false });
    expect(normalizePrescriptions([{ medication: 'X', quantity: 2.5 }])).toMatchObject({ ok: false });
    expect(normalizePrescriptions([{ medication: 'X', quantity: 'lots' }])).toMatchObject({ ok: false });
  });

  it('rejects non-lists and over-long values', () => {
    expect(normalizePrescriptions('Coartem' as any)).toMatchObject({ ok: false });
    expect(normalizePrescriptions([{ medication: 'x'.repeat(121) }])).toMatchObject({ ok: false });
    expect(normalizePrescriptions(Array.from({ length: 31 }, () => ({ medication: 'X' })))).toMatchObject({ ok: false });
  });
});

describe('HMIS 105 classification', () => {
  it('uses the ICD-10 code when there is one', () => {
    expect(classifyHmisCondition({ icd10Code: 'B54', description: 'anything', certainty: 'CONFIRMED' })).toBe('malaria');
    expect(classifyHmisCondition({ icd10Code: 'B50.9', description: 'x', certainty: 'CONFIRMED' })).toBe('malaria');
    expect(classifyHmisCondition({ icd10Code: 'R50.9', description: 'x' })).toBe('fever');
    expect(classifyHmisCondition({ icd10Code: 'A09', description: 'x' })).toBe('dysentery');
    expect(classifyHmisCondition({ icd10Code: 'A03.9', description: 'x' })).toBe('dysentery');
    expect(classifyHmisCondition({ icd10Code: 'B05.9', description: 'x' })).toBe('measles');
    expect(classifyHmisCondition({ icd10Code: 'G03.9', description: 'x' })).toBe('meningitis');
    expect(classifyHmisCondition({ icd10Code: 'A39.0', description: 'x' })).toBe('meningitis');
    expect(classifyHmisCondition({ icd10Code: 'J18.9', description: 'x' })).toBe('respiratory');
    expect(classifyHmisCondition({ icd10Code: 'J06.9', description: 'x' })).toBe('respiratory');
    expect(classifyHmisCondition({ icd10Code: 'I10', description: 'Hypertension' })).toBe('other');
  });

  it('trusts the code over the wording - a coded non-malaria diagnosis is not counted as malaria', () => {
    expect(classifyHmisCondition({ icd10Code: 'J06.9', description: 'Not malaria - viral URTI' })).toBe('respiratory');
    expect(classifyHmisCondition({ icd10Code: 'I10', description: 'Hypertension, malaria excluded' })).toBe('other');
  });

  it('reports a suspected (provisional) malaria as unconfirmed rather than confirmed', () => {
    expect(classifyHmisCondition({ icd10Code: 'B54', description: 'Suspected malaria', certainty: 'PROVISIONAL' })).toBe('fever');
    expect(classifyHmisCondition({ description: 'Malaria', certainty: 'PROVISIONAL' })).toBe('fever');
  });

  it('falls back to the wording for diagnoses recorded before coding', () => {
    expect(classifyHmisCondition({ description: 'Severe malaria' })).toBe('malaria');
    expect(classifyHmisCondition({ description: 'Acute diarrhoea' })).toBe('dysentery');
    expect(classifyHmisCondition({ description: 'Chest pneumonia' })).toBe('respiratory');
    expect(classifyHmisCondition({ description: 'Sprained ankle' })).toBe('other');
  });
});

describe('rankDiagnoses', () => {
  it('counts one condition once however it was worded, when it has a code', () => {
    const ranked = rankDiagnoses([
      { icd10Code: 'B54', description: 'Malaria' },
      { icd10Code: 'B54', description: 'Malaria' },
      { icd10Code: 'B54', description: 'malaria (RDT+)' },
      { icd10Code: 'J06.9', description: 'URTI' },
    ]);
    expect(ranked[0]).toEqual({ diagnosis: 'Malaria', icd10Code: 'B54', _count: { diagnosis: 3 } });
    expect(ranked[1]).toEqual({ diagnosis: 'URTI', icd10Code: 'J06.9', _count: { diagnosis: 1 } });
  });

  it('groups uncoded diagnoses by wording, ignoring case, and limits the list', () => {
    const ranked = rankDiagnoses([
      { icd10Code: null, description: 'Flu' }, { icd10Code: null, description: 'flu' }, { icd10Code: null, description: 'Cold' },
    ], 1);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]._count.diagnosis).toBe(2);
  });
});

describe('prescription wording', () => {
  it('writes a full prescription the way it appears on paper', () => {
    expect(
      formatPrescriptionLine({
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
    const sig = (route: string) => formatPrescriptionLine({ medication: 'X', dosage: '1 unit', route, frequency: 'OD', duration: '' }).sig;
    expect(sig('TOP')).toBe('Apply 1 unit to the skin once daily (OD)');
    expect(sig('IM')).toBe('Give 1 unit by intramuscular injection once daily (OD)');
    expect(sig('EYE')).toBe('Instil 1 unit in the eye once daily (OD)');
  });

  it('reads older free-text prescriptions sensibly, keeping wording it does not recognise', () => {
    expect(formatPrescriptionLine({ medication: 'Coartem', dosage: '4 tablets', frequency: 'twice daily', duration: '3 days' })).toEqual({
      title: 'Coartem', sig: '4 tablets twice daily for 3 days', quantity: null, instructions: null,
    });
    expect(formatPrescriptionLine({ medication: 'Coartem', dosage: '4 tablets', frequency: 'bd', duration: '3 days' }).sig).toBe('4 tablets twice daily (BD) for 3 days');
  });

  it('expands standard frequency codes and leaves anything else as written', () => {
    expect(describeFrequency('qds')).toBe('four times daily (QDS)');
    expect(describeFrequency('PRN')).toBe('when required (PRN)');
    expect(describeFrequency('every other day')).toBe('every other day');
  });
});
