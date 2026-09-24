// Commonly prescribed medicines in Ugandan primary care, by generic name, with
// the strengths and forms they usually come in. Bundled so prescribing works
// offline and so the same drug is always written the same way (the generic name,
// with a brand people know in `aka` for searching). It is a convenience, not a
// formulary: any medicine can still be typed in, and the facility's own stock
// list is offered first.

import type { RouteCode } from './prescription';

export type CatalogVariant = { strength: string; form: string };

export type CatalogMedicine = {
  name: string;
  /** Brand names and other terms people search by. */
  aka?: string;
  route: RouteCode;
  variants: CatalogVariant[];
};

const v = (strength: string, form: string): CatalogVariant => ({ strength, form });

export const MEDICINES_CATALOG: CatalogMedicine[] = [
  // Antimalarials
  { name: 'Artemether/Lumefantrine', aka: 'coartem al act malaria', route: 'PO', variants: [v('20/120 mg', 'tablet'), v('20/120 mg dispersible', 'tablet')] },
  { name: 'Artesunate', aka: 'severe malaria', route: 'IV', variants: [v('60 mg', 'injection')] },
  { name: 'Artesunate/Amodiaquine', aka: 'asaq act malaria', route: 'PO', variants: [v('25/67.5 mg', 'tablet'), v('100/270 mg', 'tablet')] },
  { name: 'Dihydroartemisinin/Piperaquine', aka: 'duocotecxin eurartesim act malaria', route: 'PO', variants: [v('40/320 mg', 'tablet')] },
  { name: 'Quinine', aka: 'malaria', route: 'PO', variants: [v('300 mg', 'tablet'), v('300 mg/ml', 'injection')] },
  { name: 'Sulfadoxine/Pyrimethamine', aka: 'fansidar sp ipt malaria pregnancy', route: 'PO', variants: [v('500/25 mg', 'tablet')] },

  // Antibiotics
  { name: 'Amoxicillin', aka: 'amoxil', route: 'PO', variants: [v('250 mg', 'capsule'), v('500 mg', 'capsule'), v('125 mg/5 ml', 'suspension'), v('250 mg/5 ml', 'suspension'), v('250 mg dispersible', 'tablet')] },
  { name: 'Amoxicillin/Clavulanic acid', aka: 'augmentin co-amoxiclav', route: 'PO', variants: [v('625 mg', 'tablet'), v('1 g', 'tablet'), v('228 mg/5 ml', 'suspension')] },
  { name: 'Ampicillin', route: 'IV', variants: [v('500 mg', 'injection'), v('1 g', 'injection')] },
  { name: 'Benzylpenicillin', aka: 'penicillin g crystalline', route: 'IV', variants: [v('1 MU', 'injection'), v('5 MU', 'injection')] },
  { name: 'Phenoxymethylpenicillin', aka: 'penicillin v pen v', route: 'PO', variants: [v('250 mg', 'tablet')] },
  { name: 'Flucloxacillin', aka: 'floxapen', route: 'PO', variants: [v('250 mg', 'capsule'), v('500 mg', 'capsule')] },
  { name: 'Cefalexin', aka: 'cephalexin keflex', route: 'PO', variants: [v('250 mg', 'capsule'), v('500 mg', 'capsule')] },
  { name: 'Ceftriaxone', aka: 'rocephin', route: 'IV', variants: [v('250 mg', 'injection'), v('1 g', 'injection')] },
  { name: 'Cefixime', aka: 'suprax', route: 'PO', variants: [v('200 mg', 'tablet'), v('100 mg/5 ml', 'suspension')] },
  { name: 'Gentamicin', route: 'IM', variants: [v('80 mg/2 ml', 'injection')] },
  { name: 'Azithromycin', aka: 'zithromax', route: 'PO', variants: [v('250 mg', 'tablet'), v('500 mg', 'tablet'), v('200 mg/5 ml', 'suspension')] },
  { name: 'Erythromycin', route: 'PO', variants: [v('250 mg', 'tablet'), v('500 mg', 'tablet'), v('125 mg/5 ml', 'suspension')] },
  { name: 'Doxycycline', route: 'PO', variants: [v('100 mg', 'capsule')] },
  { name: 'Ciprofloxacin', aka: 'cipro', route: 'PO', variants: [v('250 mg', 'tablet'), v('500 mg', 'tablet')] },
  { name: 'Metronidazole', aka: 'flagyl', route: 'PO', variants: [v('200 mg', 'tablet'), v('400 mg', 'tablet'), v('200 mg/5 ml', 'suspension')] },
  { name: 'Cotrimoxazole', aka: 'septrin bactrim sulfamethoxazole trimethoprim', route: 'PO', variants: [v('480 mg', 'tablet'), v('960 mg', 'tablet'), v('240 mg/5 ml', 'suspension')] },
  { name: 'Nitrofurantoin', route: 'PO', variants: [v('100 mg', 'capsule')] },
  { name: 'Chloramphenicol', route: 'EYE', variants: [v('0.5%', 'eye drops'), v('1%', 'eye ointment')] },
  { name: 'Tetracycline', route: 'EYE', variants: [v('1%', 'eye ointment')] },

  // Antiparasitics and antifungals
  { name: 'Albendazole', aka: 'worms deworming', route: 'PO', variants: [v('400 mg', 'tablet'), v('200 mg/5 ml', 'suspension')] },
  { name: 'Mebendazole', aka: 'worms deworming', route: 'PO', variants: [v('100 mg', 'tablet'), v('500 mg', 'tablet')] },
  { name: 'Praziquantel', aka: 'bilharzia schistosomiasis', route: 'PO', variants: [v('600 mg', 'tablet')] },
  { name: 'Fluconazole', route: 'PO', variants: [v('50 mg', 'capsule'), v('150 mg', 'capsule'), v('200 mg', 'tablet')] },
  { name: 'Clotrimazole', aka: 'canesten thrush', route: 'TOP', variants: [v('1%', 'cream'), v('500 mg', 'pessary')] },
  { name: 'Benzyl benzoate', aka: 'scabies', route: 'TOP', variants: [v('25%', 'lotion')] },
  { name: 'Ivermectin', aka: 'scabies onchocerciasis', route: 'PO', variants: [v('3 mg', 'tablet')] },

  // HIV and TB
  { name: 'Tenofovir/Lamivudine/Dolutegravir', aka: 'tld art hiv', route: 'PO', variants: [v('300/300/50 mg', 'tablet')] },
  { name: 'Isoniazid', aka: 'inh tb', route: 'PO', variants: [v('100 mg', 'tablet'), v('300 mg', 'tablet')] },
  { name: 'Rifampicin/Isoniazid/Pyrazinamide/Ethambutol', aka: 'rhze tb fixed dose', route: 'PO', variants: [v('150/75/400/275 mg', 'tablet')] },
  { name: 'Pyridoxine', aka: 'vitamin b6', route: 'PO', variants: [v('25 mg', 'tablet')] },

  // Pain, fever and inflammation
  { name: 'Paracetamol', aka: 'panadol acetaminophen', route: 'PO', variants: [v('500 mg', 'tablet'), v('120 mg/5 ml', 'suspension'), v('100 mg', 'suppository')] },
  { name: 'Ibuprofen', aka: 'brufen', route: 'PO', variants: [v('200 mg', 'tablet'), v('400 mg', 'tablet'), v('100 mg/5 ml', 'suspension')] },
  { name: 'Diclofenac', aka: 'voltaren', route: 'PO', variants: [v('50 mg', 'tablet'), v('75 mg/3 ml', 'injection'), v('1%', 'gel')] },
  { name: 'Aspirin', route: 'PO', variants: [v('75 mg', 'tablet'), v('300 mg', 'tablet')] },
  { name: 'Tramadol', route: 'PO', variants: [v('50 mg', 'capsule')] },
  { name: 'Morphine', route: 'PO', variants: [v('10 mg/5 ml', 'oral solution'), v('10 mg/ml', 'injection')] },
  { name: 'Prednisolone', route: 'PO', variants: [v('5 mg', 'tablet')] },
  { name: 'Dexamethasone', route: 'IV', variants: [v('4 mg/ml', 'injection'), v('0.5 mg', 'tablet')] },
  { name: 'Hydrocortisone', route: 'IV', variants: [v('100 mg', 'injection'), v('1%', 'cream')] },

  // Stomach, gut and rehydration
  { name: 'Oral rehydration salts', aka: 'ors diarrhoea', route: 'PO', variants: [v('low osmolarity', 'sachet')] },
  { name: 'Zinc sulfate', aka: 'zinc diarrhoea', route: 'PO', variants: [v('20 mg dispersible', 'tablet')] },
  { name: 'Omeprazole', route: 'PO', variants: [v('20 mg', 'capsule'), v('40 mg', 'capsule')] },
  { name: 'Magnesium trisilicate', aka: 'antacid mist mag trisil', route: 'PO', variants: [v('500 mg', 'tablet'), v('500 mg/5 ml', 'suspension')] },
  { name: 'Hyoscine butylbromide', aka: 'buscopan', route: 'PO', variants: [v('10 mg', 'tablet'), v('20 mg/ml', 'injection')] },
  { name: 'Metoclopramide', aka: 'plasil', route: 'PO', variants: [v('10 mg', 'tablet'), v('10 mg/2 ml', 'injection')] },
  { name: 'Promethazine', aka: 'phenergan', route: 'PO', variants: [v('25 mg', 'tablet'), v('25 mg/ml', 'injection')] },
  { name: 'Lactulose', route: 'PO', variants: [v('3.35 g/5 ml', 'syrup')] },

  // Breathing and allergy
  { name: 'Salbutamol', aka: 'ventolin asthma', route: 'INH', variants: [v('100 mcg/dose', 'inhaler'), v('2.5 mg/2.5 ml', 'nebuliser solution'), v('4 mg', 'tablet'), v('2 mg/5 ml', 'syrup')] },
  { name: 'Beclometasone', aka: 'asthma steroid inhaler', route: 'INH', variants: [v('100 mcg/dose', 'inhaler')] },
  { name: 'Chlorphenamine', aka: 'piriton allergy', route: 'PO', variants: [v('4 mg', 'tablet'), v('2 mg/5 ml', 'syrup')] },
  { name: 'Cetirizine', aka: 'zyrtec allergy', route: 'PO', variants: [v('10 mg', 'tablet'), v('5 mg/5 ml', 'syrup')] },
  { name: 'Loratadine', aka: 'allergy', route: 'PO', variants: [v('10 mg', 'tablet')] },

  // Heart, blood pressure and diabetes
  { name: 'Amlodipine', route: 'PO', variants: [v('5 mg', 'tablet'), v('10 mg', 'tablet')] },
  { name: 'Nifedipine', route: 'PO', variants: [v('10 mg', 'tablet'), v('20 mg retard', 'tablet')] },
  { name: 'Enalapril', route: 'PO', variants: [v('5 mg', 'tablet'), v('10 mg', 'tablet')] },
  { name: 'Lisinopril', route: 'PO', variants: [v('5 mg', 'tablet'), v('10 mg', 'tablet')] },
  { name: 'Atenolol', route: 'PO', variants: [v('50 mg', 'tablet'), v('100 mg', 'tablet')] },
  { name: 'Hydrochlorothiazide', aka: 'hctz diuretic', route: 'PO', variants: [v('25 mg', 'tablet')] },
  { name: 'Furosemide', aka: 'lasix frusemide diuretic', route: 'PO', variants: [v('40 mg', 'tablet'), v('20 mg/2 ml', 'injection')] },
  { name: 'Methyldopa', aka: 'pregnancy hypertension', route: 'PO', variants: [v('250 mg', 'tablet')] },
  { name: 'Simvastatin', aka: 'statin cholesterol', route: 'PO', variants: [v('20 mg', 'tablet')] },
  { name: 'Metformin', aka: 'glucophage diabetes', route: 'PO', variants: [v('500 mg', 'tablet'), v('850 mg', 'tablet')] },
  { name: 'Glibenclamide', aka: 'diabetes', route: 'PO', variants: [v('5 mg', 'tablet')] },
  { name: 'Insulin (soluble)', aka: 'actrapid diabetes', route: 'SC', variants: [v('100 IU/ml', 'injection')] },
  { name: 'Insulin (isophane)', aka: 'nph insulatard diabetes', route: 'SC', variants: [v('100 IU/ml', 'injection')] },

  // Pregnancy, family planning and childbirth
  { name: 'Ferrous sulfate/Folic acid', aka: 'iron folate anc anaemia pregnancy', route: 'PO', variants: [v('200/0.25 mg', 'tablet'), v('60 mg/400 mcg', 'tablet')] },
  { name: 'Ferrous sulfate', aka: 'iron anaemia', route: 'PO', variants: [v('200 mg', 'tablet'), v('200 mg/5 ml', 'syrup')] },
  { name: 'Folic acid', route: 'PO', variants: [v('5 mg', 'tablet')] },
  { name: 'Oxytocin', aka: 'pph labour', route: 'IM', variants: [v('10 IU/ml', 'injection')] },
  { name: 'Misoprostol', aka: 'pph abortion', route: 'PO', variants: [v('200 mcg', 'tablet')] },
  { name: 'Magnesium sulfate', aka: 'eclampsia pre-eclampsia', route: 'IV', variants: [v('50%', 'injection')] },
  { name: 'Levonorgestrel/Ethinylestradiol', aka: 'combined pill microgynon family planning', route: 'PO', variants: [v('150/30 mcg', 'tablet')] },
  { name: 'Medroxyprogesterone', aka: 'depo-provera injectable family planning', route: 'IM', variants: [v('150 mg/ml', 'injection')] },
  { name: 'Levonorgestrel', aka: 'emergency contraception postinor', route: 'PO', variants: [v('1.5 mg', 'tablet')] },

  // Vitamins and supplements
  { name: 'Vitamin A', aka: 'retinol', route: 'PO', variants: [v('200,000 IU', 'capsule'), v('100,000 IU', 'capsule')] },
  { name: 'Multivitamin', route: 'PO', variants: [v('standard', 'tablet'), v('standard', 'syrup')] },
  { name: 'Vitamin B complex', route: 'PO', variants: [v('standard', 'tablet')] },
  { name: 'Vitamin C', aka: 'ascorbic acid', route: 'PO', variants: [v('100 mg', 'tablet'), v('500 mg', 'tablet')] },

  // Nervous system and mental health
  { name: 'Diazepam', aka: 'valium', route: 'PO', variants: [v('5 mg', 'tablet'), v('10 mg/2 ml', 'injection')] },
  { name: 'Phenobarbital', aka: 'phenobarbitone epilepsy', route: 'PO', variants: [v('30 mg', 'tablet'), v('60 mg', 'tablet')] },
  { name: 'Carbamazepine', aka: 'epilepsy', route: 'PO', variants: [v('200 mg', 'tablet')] },
  { name: 'Phenytoin', aka: 'epilepsy', route: 'PO', variants: [v('100 mg', 'tablet')] },
  { name: 'Amitriptyline', aka: 'depression', route: 'PO', variants: [v('25 mg', 'tablet')] },
  { name: 'Fluoxetine', aka: 'depression', route: 'PO', variants: [v('20 mg', 'capsule')] },
  { name: 'Haloperidol', route: 'PO', variants: [v('5 mg', 'tablet'), v('5 mg/ml', 'injection')] },

  // Skin, wounds and local use
  { name: 'Silver sulfadiazine', aka: 'burns', route: 'TOP', variants: [v('1%', 'cream')] },
  { name: 'Calamine', aka: 'itching', route: 'TOP', variants: [v('standard', 'lotion')] },
  { name: 'Lidocaine', aka: 'lignocaine local anaesthetic', route: 'SC', variants: [v('2%', 'injection'), v('2%', 'gel')] },
  { name: 'Povidone iodine', aka: 'betadine antiseptic', route: 'TOP', variants: [v('10%', 'solution')] },
  { name: 'Tetanus toxoid', aka: 'tt vaccine', route: 'IM', variants: [v('0.5 ml', 'injection')] },
];

/** Medicines matching what has been typed - by name or brand - best matches first. */
export function searchMedicinesCatalog(query: string, limit = 8): CatalogMedicine[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);

  const scored: Array<{ medicine: CatalogMedicine; score: number }> = [];
  for (const medicine of MEDICINES_CATALOG) {
    const name = medicine.name.toLowerCase();
    const haystack = `${name} ${medicine.aka ?? ''}`.toLowerCase();
    if (!words.every((w) => haystack.includes(w))) continue;

    let score = 1;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (words.every((w) => haystack.split(/[^a-z0-9]+/).includes(w))) score = 70;
    else if (words.every((w) => haystack.split(/[^a-z0-9]+/).some((t) => t.startsWith(w)))) score = 50;
    scored.push({ medicine, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.medicine.name.localeCompare(b.medicine.name))
    .slice(0, limit)
    .map((s) => s.medicine);
}
