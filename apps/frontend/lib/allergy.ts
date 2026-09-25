// Allergies: what is recorded for a patient, and whether a medicine about to be
// prescribed (or dispensed) matches one. The matching runs on the device, so the
// warning works offline - which is where most prescribing happens.
//
// It is a safety net, not a substitute for clinical judgement: it recognises the
// drug named, and the common drug classes ("penicillin" allergy -> amoxicillin),
// but it cannot know every brand or cross-reaction. A prescriber must still ask.

export type AllergyStatus = 'UNKNOWN' | 'NONE_KNOWN' | 'KNOWN';
export type Severity = 'MILD' | 'MODERATE' | 'SEVERE';

export type Allergy = {
  substance: string;
  reaction?: string | null;
  severity?: Severity | null;
};

export type AllergyRecord = {
  allergyStatus?: AllergyStatus;
  allergies?: Allergy[] | null;
};

export const SEVERITY_LABELS: Record<Severity, string> = { MILD: 'Mild', MODERATE: 'Moderate', SEVERE: 'Severe' };

export const MAX_ALLERGIES = 20;

/** Common things to pick from when recording - the drug allergies most often met in practice, then a few others. */
export const COMMON_ALLERGENS = [
  'Penicillin', 'Amoxicillin', 'Cephalosporins', 'Sulfa drugs (cotrimoxazole)', 'Aspirin', 'NSAIDs (ibuprofen, diclofenac)',
  'Erythromycin / macrolides', 'Quinolones (ciprofloxacin)', 'Tetracyclines (doxycycline)', 'Gentamicin / aminoglycosides',
  'Chloroquine', 'Quinine', 'Codeine / opioids', 'Local anaesthetic (lidocaine)', 'Iodine', 'Metronidazole',
  'Latex', 'Eggs', 'Peanuts', 'Fish / shellfish', 'Bee or wasp sting',
];

// Drug classes: a name people record ("penicillin", "NSAIDs", "sulfa") and the
// medicines - generic and common brand names - that belong to it. An allergy to
// the class matches any member; an allergy to one member matches that drug.
const CLASSES: Array<{ name: string; label: string; terms: string[]; members: string[] }> = [
  { name: 'penicillins', label: 'penicillin', terms: ['penicillin', 'penicilin', 'beta-lactam', 'beta lactam'],
    members: ['penicillin', 'amoxicillin', 'amoxil', 'ampicillin', 'flucloxacillin', 'floxapen', 'cloxacillin', 'benzylpenicillin', 'phenoxymethylpenicillin', 'piperacillin', 'clavulanic', 'co-amoxiclav', 'augmentin'] },
  { name: 'cephalosporins', label: 'cephalosporin', terms: ['cephalosporin', 'cefalosporin', 'ceph'],
    members: ['cefalexin', 'cephalexin', 'keflex', 'ceftriaxone', 'rocephin', 'cefixime', 'suprax', 'cefuroxime', 'cefotaxime', 'ceftazidime', 'cefazolin', 'cefpodoxime'] },
  { name: 'sulfonamides', label: 'sulfa', terms: ['sulfa', 'sulpha', 'sulfonamide', 'cotrimoxazole', 'co-trimoxazole'],
    members: ['sulfa', 'sulpha', 'sulfonamide', 'cotrimoxazole', 'co-trimoxazole', 'septrin', 'bactrim', 'sulfamethoxazole', 'sulfadoxine', 'sulfadiazine', 'fansidar'] },
  { name: 'nsaids', label: 'NSAID', terms: ['nsaid', 'anti-inflammatory', 'anti inflammatory'],
    members: ['ibuprofen', 'brufen', 'diclofenac', 'voltaren', 'aspirin', 'naproxen', 'indomethacin', 'ketoprofen', 'piroxicam', 'mefenamic', 'meloxicam', 'ketorolac'] },
  { name: 'macrolides', label: 'macrolide', terms: ['macrolide'],
    members: ['erythromycin', 'azithromycin', 'zithromax', 'clarithromycin'] },
  { name: 'quinolones', label: 'quinolone', terms: ['quinolone', 'fluoroquinolone'],
    members: ['ciprofloxacin', 'cipro', 'levofloxacin', 'ofloxacin', 'norfloxacin', 'moxifloxacin'] },
  { name: 'tetracyclines', label: 'tetracycline', terms: ['tetracycline'],
    members: ['tetracycline', 'doxycycline', 'minocycline'] },
  { name: 'aminoglycosides', label: 'aminoglycoside', terms: ['aminoglycoside'],
    members: ['gentamicin', 'amikacin', 'streptomycin', 'kanamycin', 'tobramycin'] },
  { name: 'opioids', label: 'opioid', terms: ['opioid', 'opiate', 'narcotic'],
    members: ['morphine', 'codeine', 'tramadol', 'pethidine', 'fentanyl', 'oxycodone'] },
  { name: 'local anaesthetics', label: 'local anaesthetic', terms: ['local anaesthetic', 'local anesthetic', 'caine'],
    members: ['lidocaine', 'lignocaine', 'bupivacaine', 'procaine'] },
  { name: 'iodine', label: 'iodine', terms: ['iodine', 'iodide'],
    members: ['iodine', 'povidone', 'betadine'] },
  { name: 'antimalarial aminoquinolines', label: 'chloroquine', terms: ['chloroquine'],
    members: ['chloroquine', 'amodiaquine', 'hydroxychloroquine'] },
  { name: 'paracetamol', label: 'paracetamol', terms: ['paracetamol', 'acetaminophen'],
    members: ['paracetamol', 'acetaminophen', 'panadol'] },
];

export type AllergyConflict = {
  allergy: Allergy;
  /** Why it matched: the very drug, or a drug of the class the allergy names. */
  kind: 'drug' | 'class';
  /** For a class match, the class ("penicillin"), so the warning can say why. */
  className?: string;
};

const clean = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

// A drug's name without its strength or any bracketed note, so "Amoxicillin 500 mg"
// and "amoxicillin" are the same drug but "Amoxicillin" and "Benzylpenicillin" are not.
const coreName = (text: string) => clean(text.replace(/\(.*?\)/g, ' ').replace(/[0-9][0-9.,/]*\s*(mg|mcg|g|ml|iu|%)?/gi, ' '));

/**
 * The recorded allergies that the medicine matches - by the very drug named, or
 * because the allergy names a drug class the medicine belongs to. Empty when
 * nothing is recorded, none are known, or nothing matches.
 */
export function findAllergyConflicts(record: AllergyRecord | null | undefined, medication: string): AllergyConflict[] {
  const med = clean(medication);
  if (!med || !record || record.allergyStatus !== 'KNOWN' || !Array.isArray(record.allergies)) return [];

  const conflicts: AllergyConflict[] = [];
  for (const allergy of record.allergies) {
    const substance = clean(allergy.substance || '');
    if (!substance) continue;

    // The very drug.
    if (coreName(substance) !== '' && coreName(substance) === coreName(med)) {
      conflicts.push({ allergy, kind: 'drug' });
      continue;
    }

    // A drug of the class the allergy names (or of the class of the drug it names).
    const cls = CLASSES.find((c) => {
      const allergyInClass = c.terms.some((t) => substance.includes(t)) || c.members.some((m) => m.length >= 5 && substance.includes(m));
      const medicineInClass = c.members.some((m) => med.includes(m));
      return allergyInClass && medicineInClass;
    });
    if (cls) {
      conflicts.push({ allergy, kind: 'class', className: cls.label });
      continue;
    }

    // Anything else where one name contains the other ("metronidazole" vs "metronidazole tablets").
    if (substance.length >= 4 && med.length >= 4 && (med.includes(substance) || substance.includes(med))) {
      conflicts.push({ allergy, kind: 'drug' });
    }
  }
  return conflicts;
}

/** One warning line: "Recorded allergy: Penicillin (anaphylaxis, severe) - amoxicillin is a penicillin." */
export function describeConflict(conflict: AllergyConflict, medication: string): string {
  const { allergy } = conflict;
  const details = [allergy.reaction, allergy.severity ? SEVERITY_LABELS[allergy.severity].toLowerCase() : null].filter(Boolean).join(', ');
  const recorded = `Recorded allergy: ${allergy.substance}${details ? ` (${details})` : ''}`;
  return conflict.kind === 'class'
    ? `${recorded} - ${medication.trim()} is in the ${conflict.className} class.`
    : `${recorded} - this is the medicine being prescribed.`;
}

/** What to tell someone about a patient's allergy record at a glance. */
export function allergySummary(record: AllergyRecord | null | undefined): { tone: 'unknown' | 'none' | 'known'; text: string } {
  const status = record?.allergyStatus ?? 'UNKNOWN';
  if (status === 'NONE_KNOWN') return { tone: 'none', text: 'No known allergies' };
  if (status === 'KNOWN' && record?.allergies && record.allergies.length > 0) {
    return { tone: 'known', text: record.allergies.map((a) => a.substance).join(', ') };
  }
  return { tone: 'unknown', text: 'Allergies not recorded - ask the patient before prescribing' };
}

// ---------------------------------------------------------------------------
// The form's working state
// ---------------------------------------------------------------------------

export type AllergyDraft = { key: string; substance: string; reaction: string; severity: '' | Severity };

let counter = 0;
export function emptyAllergyDraft(): AllergyDraft {
  counter += 1;
  return { key: `al-${Date.now()}-${counter}`, substance: '', reaction: '', severity: '' };
}

export function draftsFromRecord(record: AllergyRecord | null | undefined): AllergyDraft[] {
  const list = record?.allergyStatus === 'KNOWN' ? record.allergies ?? [] : [];
  return list.length > 0
    ? list.map((a) => ({ ...emptyAllergyDraft(), substance: a.substance, reaction: a.reaction ?? '', severity: a.severity ?? '' }))
    : [emptyAllergyDraft()];
}

export function allergyProblems(status: AllergyStatus, drafts: AllergyDraft[]): string[] {
  if (status !== 'KNOWN') return [];
  return drafts.some((d) => d.substance.trim()) ? [] : ['Name at least one allergy, or choose "No known allergies".'];
}

export function draftsToPayload(status: AllergyStatus, drafts: AllergyDraft[]): { allergyStatus: AllergyStatus; allergies: Allergy[] } {
  if (status !== 'KNOWN') return { allergyStatus: status, allergies: [] };
  const seen = new Set<string>();
  const allergies: Allergy[] = [];
  for (const d of drafts) {
    const substance = d.substance.trim();
    if (!substance || seen.has(substance.toLowerCase())) continue;
    seen.add(substance.toLowerCase());
    allergies.push({ substance, reaction: d.reaction.trim() || null, severity: d.severity || null });
  }
  return { allergyStatus: 'KNOWN', allergies };
}
