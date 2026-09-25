import { describe, expect, it } from 'vitest';
import {
  COMMON_ALLERGENS, allergyProblems, allergySummary, describeConflict, draftsFromRecord, draftsToPayload, emptyAllergyDraft,
  findAllergyConflicts, type AllergyRecord,
} from './allergy';
import { MEDICINES_CATALOG } from './medicines-catalog';

const known = (...substances: Array<string | { substance: string; reaction?: string; severity?: 'MILD' | 'MODERATE' | 'SEVERE' }>): AllergyRecord => ({
  allergyStatus: 'KNOWN',
  allergies: substances.map((s) => (typeof s === 'string' ? { substance: s } : s)),
});

describe('matching a medicine against recorded allergies', () => {
  it('matches the very drug, however it is written', () => {
    expect(findAllergyConflicts(known('Amoxicillin'), 'Amoxicillin')[0]).toMatchObject({ kind: 'drug' });
    expect(findAllergyConflicts(known('Metronidazole'), 'Metronidazole 400 mg tablets')[0]).toMatchObject({ kind: 'drug' });
    expect(findAllergyConflicts(known('amoxicillin'), '  AMOXICILLIN 500 mg ')[0]).toMatchObject({ kind: 'drug' });
    expect(findAllergyConflicts(known('Paracetamol'), 'Paracetamol')).toHaveLength(1);
  });

  it('matches every medicine of a class the allergy names', () => {
    for (const drug of ['Amoxicillin', 'Ampicillin', 'Flucloxacillin', 'Benzylpenicillin', 'Amoxicillin/Clavulanic acid', 'Augmentin']) {
      const [conflict] = findAllergyConflicts(known('Penicillin'), drug);
      expect(conflict, drug).toMatchObject({ kind: 'class', className: 'penicillin' });
    }
    expect(findAllergyConflicts(known('Sulfa drugs (cotrimoxazole)'), 'Sulfadoxine/Pyrimethamine')[0].kind).toBe('class');
    expect(findAllergyConflicts(known('NSAIDs'), 'Diclofenac')[0]).toMatchObject({ kind: 'class', className: 'NSAID' });
    expect(findAllergyConflicts(known('NSAIDs'), 'Aspirin')).toHaveLength(1);
    expect(findAllergyConflicts(known('Cephalosporins'), 'Ceftriaxone')).toHaveLength(1);
    expect(findAllergyConflicts(known('Quinolones (ciprofloxacin)'), 'Ciprofloxacin')).toHaveLength(1);
    expect(findAllergyConflicts(known('Codeine / opioids'), 'Tramadol')).toHaveLength(1);
    expect(findAllergyConflicts(known('Local anaesthetic (lidocaine)'), 'Lignocaine')).toHaveLength(1);
  });

  it('recognises a brand name as its class', () => {
    expect(findAllergyConflicts(known('Penicillin'), 'Augmentin')).toHaveLength(1);
    expect(findAllergyConflicts(known('Sulfa'), 'Septrin')).toHaveLength(1);
  });

  it('an allergy to one drug in a class also flags its relatives', () => {
    expect(findAllergyConflicts(known('Amoxicillin'), 'Ampicillin')[0]).toMatchObject({ kind: 'class', className: 'penicillin' });
  });

  it('does not flag unrelated medicines', () => {
    expect(findAllergyConflicts(known('Penicillin'), 'Paracetamol')).toEqual([]);
    expect(findAllergyConflicts(known('Penicillin'), 'Ceftriaxone')).toEqual([]);
    expect(findAllergyConflicts(known('NSAIDs'), 'Paracetamol')).toEqual([]);
    expect(findAllergyConflicts(known('Peanuts', 'Latex'), 'Amoxicillin')).toEqual([]);
    expect(findAllergyConflicts(known('Quinine'), 'Chloroquine')).toEqual([]);
  });

  it('says nothing unless an allergy is actually recorded', () => {
    expect(findAllergyConflicts({ allergyStatus: 'UNKNOWN' }, 'Amoxicillin')).toEqual([]);
    expect(findAllergyConflicts({ allergyStatus: 'NONE_KNOWN' }, 'Amoxicillin')).toEqual([]);
    expect(findAllergyConflicts({ allergyStatus: 'KNOWN', allergies: [] }, 'Amoxicillin')).toEqual([]);
    expect(findAllergyConflicts(null, 'Amoxicillin')).toEqual([]);
    expect(findAllergyConflicts(known('Penicillin'), '')).toEqual([]);
  });

  it('reports each matching allergy', () => {
    expect(findAllergyConflicts(known('Penicillin', 'Amoxicillin', 'Peanuts'), 'Amoxicillin')).toHaveLength(2);
  });

  it('flags every penicillin in the medicines list for a penicillin allergy - and nothing that is not one', () => {
    const flagged = MEDICINES_CATALOG.filter((m) => findAllergyConflicts(known('Penicillin'), m.name).length > 0).map((m) => m.name);
    for (const expected of ['Amoxicillin', 'Amoxicillin/Clavulanic acid', 'Ampicillin', 'Benzylpenicillin', 'Phenoxymethylpenicillin', 'Flucloxacillin']) {
      expect(flagged).toContain(expected);
    }
    for (const notExpected of ['Paracetamol', 'Ceftriaxone', 'Metformin', 'Artemether/Lumefantrine', 'Azithromycin']) {
      expect(flagged).not.toContain(notExpected);
    }
  });
});

describe('wording the warning', () => {
  it('explains a class match and a direct match, with the reaction and severity', () => {
    const record = known({ substance: 'Penicillin', reaction: 'Anaphylaxis', severity: 'SEVERE' });
    expect(describeConflict(findAllergyConflicts(record, 'Amoxicillin')[0], 'Amoxicillin')).toBe(
      'Recorded allergy: Penicillin (Anaphylaxis, severe) - Amoxicillin is in the penicillin class.'
    );
    expect(describeConflict(findAllergyConflicts(known('Paracetamol'), 'Paracetamol')[0], 'Paracetamol')).toBe(
      'Recorded allergy: Paracetamol - this is the medicine being prescribed.'
    );
  });

  it('summarises a patient\'s allergy record at a glance', () => {
    expect(allergySummary(undefined)).toMatchObject({ tone: 'unknown' });
    expect(allergySummary({ allergyStatus: 'UNKNOWN' }).text).toMatch(/not recorded/i);
    expect(allergySummary({ allergyStatus: 'NONE_KNOWN' })).toEqual({ tone: 'none', text: 'No known allergies' });
    expect(allergySummary(known('Penicillin', 'Sulfa'))).toEqual({ tone: 'known', text: 'Penicillin, Sulfa' });
    expect(allergySummary({ allergyStatus: 'KNOWN', allergies: [] }).tone).toBe('unknown');
  });
});

describe('recording allergies', () => {
  it('offers common allergens once each', () => {
    expect(new Set(COMMON_ALLERGENS).size).toBe(COMMON_ALLERGENS.length);
  });

  it('needs at least one named allergy when the patient has allergies', () => {
    expect(allergyProblems('KNOWN', [emptyAllergyDraft()])).toHaveLength(1);
    expect(allergyProblems('KNOWN', [{ ...emptyAllergyDraft(), substance: 'Penicillin' }])).toEqual([]);
    expect(allergyProblems('NONE_KNOWN', [emptyAllergyDraft()])).toEqual([]);
    expect(allergyProblems('UNKNOWN', [emptyAllergyDraft()])).toEqual([]);
  });

  it('turns the form into what is saved, dropping blanks and repeats', () => {
    const drafts = [
      { ...emptyAllergyDraft(), substance: ' Penicillin ', reaction: 'Rash', severity: 'SEVERE' as const },
      emptyAllergyDraft(),
      { ...emptyAllergyDraft(), substance: 'penicillin' },
      { ...emptyAllergyDraft(), substance: 'Latex' },
    ];
    expect(draftsToPayload('KNOWN', drafts)).toEqual({
      allergyStatus: 'KNOWN',
      allergies: [{ substance: 'Penicillin', reaction: 'Rash', severity: 'SEVERE' }, { substance: 'Latex', reaction: null, severity: null }],
    });
    expect(draftsToPayload('NONE_KNOWN', drafts)).toEqual({ allergyStatus: 'NONE_KNOWN', allergies: [] });
  });

  it('loads an existing record into the form, or one blank row', () => {
    expect(draftsFromRecord(known({ substance: 'Penicillin', reaction: 'Rash', severity: 'MILD' }))[0]).toMatchObject({ substance: 'Penicillin', reaction: 'Rash', severity: 'MILD' });
    expect(draftsFromRecord({ allergyStatus: 'NONE_KNOWN' })).toHaveLength(1);
    expect(draftsFromRecord(undefined)[0].substance).toBe('');
  });
});
