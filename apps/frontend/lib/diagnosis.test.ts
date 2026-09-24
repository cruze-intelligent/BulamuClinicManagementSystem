import { describe, expect, it } from 'vitest';
import { diagnosesOf, diagnosesToPayload, diagnosisHeadline, diagnosisProblems, emptyDiagnosis, type DiagnosisDraft } from './diagnosis';

const draft = (patch: Partial<DiagnosisDraft>): DiagnosisDraft => ({ ...emptyDiagnosis(), ...patch });

describe('diagnosis entry', () => {
  it('needs at least one diagnosis, with a name', () => {
    expect(diagnosisProblems([emptyDiagnosis()])).toEqual(['Add at least one diagnosis.']);
    expect(diagnosisProblems([draft({ icd10Code: 'B54' })])).toEqual(['The primary diagnosis needs a name.']);
    expect(diagnosisProblems([draft({ description: 'Malaria' })])).toEqual([]);
  });

  it('flags a code that is not an ICD-10 code, and accepts any valid one', () => {
    expect(diagnosisProblems([draft({ description: 'Malaria', icd10Code: 'malaria' })])[0]).toMatch(/not a valid ICD-10 code/);
    expect(diagnosisProblems([draft({ description: 'Rare thing', icd10Code: 'q87.1' })])).toEqual([]);
  });

  it('makes the first diagnosis primary, drops blank rows and tidies the code', () => {
    const payload = diagnosesToPayload([
      draft({ description: ' Malaria ', icd10Code: 'b54', certainty: 'PROVISIONAL', notes: ' RDT pending ' }),
      draft({}),
      draft({ description: 'Anaemia' }),
    ]);
    expect(payload).toEqual([
      { description: 'Malaria', icd10Code: 'B54', type: 'PRIMARY', certainty: 'PROVISIONAL', notes: 'RDT pending' },
      { description: 'Anaemia', type: 'SECONDARY', certainty: 'CONFIRMED' },
    ]);
  });
});

describe('reading diagnoses back', () => {
  it('lists the primary first', () => {
    const list = diagnosesOf({ diagnoses: [{ description: 'Anaemia', type: 'SECONDARY' }, { description: 'Malaria', type: 'PRIMARY', icd10Code: 'B54' }] });
    expect(list.map((d) => d.description)).toEqual(['Malaria', 'Anaemia']);
  });

  it('shows an older record that only has a text as one primary diagnosis', () => {
    expect(diagnosesOf({ diagnosis: 'Malaria' })).toEqual([{ description: 'Malaria', type: 'PRIMARY', certainty: 'CONFIRMED' }]);
    expect(diagnosesOf({})).toEqual([]);
  });

  it('writes a one-line headline with codes', () => {
    expect(diagnosisHeadline({ diagnoses: [{ description: 'Malaria', type: 'PRIMARY', icd10Code: 'B54' }, { description: 'Anaemia', type: 'SECONDARY' }] })).toBe('Malaria (B54) + Anaemia');
    expect(diagnosisHeadline({ diagnosis: 'Sprained ankle' })).toBe('Sprained ankle');
    expect(diagnosisHeadline({})).toBe('No diagnosis recorded');
  });
});
