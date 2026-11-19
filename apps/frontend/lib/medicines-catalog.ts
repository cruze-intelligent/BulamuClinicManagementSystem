// Commonly prescribed medicines in Ugandan primary care, by generic name, with
// the strengths and forms they usually come in. Bundled so prescribing works
// offline and so the same drug is always written the same way (the generic name,
// with a brand people know in `aka` for searching). It is a convenience, not a
// formulary: any medicine can still be typed in, and the facility's own stock
// list is offered first.
//
// Every medicine on Uganda's national essential medicines list (EMHSLU 2023,
// the list National Medical Stores supplies against) is folded in from
// medicines-national.ts, so the whole national list can be prescribed by name.

import type { RouteCode } from './prescription';
import { NATIONAL_MEDICINES } from './medicines-national';

/** A strength and form; `route` when it is given differently from the medicine's usual route (an injection of a tablet medicine). */
export type CatalogVariant = { strength: string; form: string; route?: RouteCode };

export type CatalogMedicine = {
  name: string;
  /** Brand names and other terms people search by. */
  aka?: string;
  route: RouteCode;
  variants: CatalogVariant[];
  /** On Uganda's Essential Medicines and Health Supplies List (EMHSLU 2023). */
  nationalList?: boolean;
};

const v = (strength: string, form: string, route?: RouteCode): CatalogVariant => (route ? { strength, form, route } : { strength, form });

const PRESCRIBING_LIST: CatalogMedicine[] = [
  // Antimalarials
  { name: 'Artemether/Lumefantrine', aka: 'coartem al act malaria', route: 'PO', variants: [v('20/120 mg', 'tablet'), v('20/120 mg dispersible', 'tablet')] },
  { name: 'Artesunate', aka: 'severe malaria', route: 'IV', variants: [v('60 mg', 'injection')] },
  { name: 'Artesunate/Amodiaquine', aka: 'asaq act malaria', route: 'PO', variants: [v('25/67.5 mg', 'tablet'), v('100/270 mg', 'tablet')] },
  { name: 'Dihydroartemisinin/Piperaquine', aka: 'duocotecxin eurartesim act malaria', route: 'PO', variants: [v('40/320 mg', 'tablet')] },
  { name: 'Quinine', aka: 'malaria', route: 'PO', variants: [v('300 mg', 'tablet'), v('300 mg/ml', 'injection', 'IV')] },
  { name: 'Sulfadoxine/Pyrimethamine', aka: 'fansidar sp ipt malaria pregnancy', route: 'PO', variants: [v('500/25 mg', 'tablet')] },

  // Antibiotics
  { name: 'Amoxicillin', aka: 'amoxil', route: 'PO', variants: [v('250 mg', 'capsule'), v('500 mg', 'capsule'), v('125 mg/5 ml', 'suspension'), v('250 mg/5 ml', 'suspension'), v('250 mg dispersible', 'tablet')] },
  { name: 'Amoxicillin/Clavulanic acid', aka: 'augmentin co-amoxiclav', route: 'PO', variants: [v('625 mg', 'tablet'), v('1 g', 'tablet'), v('228 mg/5 ml', 'suspension')] },
  { name: 'Ampicillin', route: 'IV', variants: [v('500 mg', 'injection'), v('1 g', 'injection')] },
  { name: 'Benzylpenicillin', aka: 'penicillin g crystalline', route: 'IV', variants: [v('1 MU', 'injection'), v('5 MU', 'injection')] },
  { name: 'Phenoxymethylpenicillin', aka: 'penicillin v pen v', route: 'PO', variants: [v('250 mg', 'tablet')] },
  { name: 'Flucloxacillin', aka: 'floxapen', route: 'PO', variants: [v('250 mg', 'capsule'), v('500 mg', 'capsule')] },
  { name: 'Cefalexin', aka: 'cephalexin keflex', route: 'PO', variants: [v('250 mg', 'capsule'), v('500 mg', 'capsule')] },
  { name: 'Ceftriaxone', aka: 'rocephin', route: 'IV', variants: [v('250 mg', 'injection'), v('500 mg', 'injection'), v('1 g', 'injection'), v('2 g', 'injection')] },
  { name: 'Cefixime', aka: 'suprax', route: 'PO', variants: [v('200 mg', 'tablet'), v('100 mg/5 ml', 'suspension')] },
  { name: 'Gentamicin', route: 'IM', variants: [v('80 mg/2 ml', 'injection')] },
  { name: 'Azithromycin', aka: 'zithromax', route: 'PO', variants: [v('250 mg', 'tablet'), v('500 mg', 'tablet'), v('200 mg/5 ml', 'suspension')] },
  { name: 'Erythromycin', route: 'PO', variants: [v('250 mg', 'tablet'), v('500 mg', 'tablet'), v('125 mg/5 ml', 'suspension')] },
  { name: 'Doxycycline', route: 'PO', variants: [v('100 mg', 'capsule')] },
  { name: 'Ciprofloxacin', aka: 'cipro', route: 'PO', variants: [v('250 mg', 'tablet'), v('500 mg', 'tablet')] },
  { name: 'Metronidazole', aka: 'flagyl', route: 'PO', variants: [v('200 mg', 'tablet'), v('400 mg', 'tablet'), v('200 mg/5 ml', 'suspension'), v('500 mg/100 ml', 'infusion', 'IV')] },
  { name: 'Cotrimoxazole', aka: 'septrin bactrim sulfamethoxazole trimethoprim', route: 'PO', variants: [v('480 mg', 'tablet'), v('960 mg', 'tablet'), v('240 mg/5 ml', 'suspension')] },
  { name: 'Nitrofurantoin', route: 'PO', variants: [v('100 mg', 'capsule')] },
  { name: 'Chloramphenicol', route: 'EYE', variants: [v('0.5%', 'eye drops'), v('1%', 'eye ointment')] },
  { name: 'Tetracycline', route: 'EYE', variants: [v('1%', 'eye ointment')] },

  // Antiparasitics and antifungals
  { name: 'Albendazole', aka: 'worms deworming', route: 'PO', variants: [v('400 mg', 'tablet'), v('200 mg/5 ml', 'suspension')] },
  { name: 'Mebendazole', aka: 'worms deworming', route: 'PO', variants: [v('100 mg', 'tablet'), v('500 mg', 'tablet')] },
  { name: 'Praziquantel', aka: 'bilharzia schistosomiasis', route: 'PO', variants: [v('600 mg', 'tablet')] },
  { name: 'Fluconazole', route: 'PO', variants: [v('50 mg', 'capsule'), v('150 mg', 'capsule'), v('200 mg', 'tablet')] },
  { name: 'Itraconazole', aka: 'sporanox fungal tinea onychomycosis candida aspergillosis histoplasmosis', route: 'PO', variants: [v('100 mg', 'capsule'), v('10 mg/ml', 'oral solution')] },
  { name: 'Clotrimazole', aka: 'canesten thrush', route: 'TOP', variants: [v('1%', 'cream'), v('500 mg', 'pessary', 'PV')] },
  { name: 'Benzyl benzoate', aka: 'scabies', route: 'TOP', variants: [v('25%', 'lotion')] },
  { name: 'Ivermectin', aka: 'scabies onchocerciasis', route: 'PO', variants: [v('3 mg', 'tablet')] },

  // HIV and TB
  { name: 'Tenofovir/Lamivudine/Dolutegravir', aka: 'tld art hiv', route: 'PO', variants: [v('300/300/50 mg', 'tablet')] },
  { name: 'Isoniazid', aka: 'inh tb', route: 'PO', variants: [v('100 mg', 'tablet'), v('300 mg', 'tablet')] },
  { name: 'Rifampicin/Isoniazid/Pyrazinamide/Ethambutol', aka: 'rhze tb fixed dose', route: 'PO', variants: [v('150/75/400/275 mg', 'tablet')] },
  { name: 'Pyridoxine', aka: 'vitamin b6', route: 'PO', variants: [v('25 mg', 'tablet')] },

  // Pain, fever and inflammation
  { name: 'Paracetamol', aka: 'panadol acetaminophen', route: 'PO', variants: [v('500 mg', 'tablet'), v('120 mg/5 ml', 'suspension'), v('100 mg', 'suppository', 'PR'), v('10 mg/ml', 'infusion', 'IV')] },
  { name: 'Ibuprofen', aka: 'brufen', route: 'PO', variants: [v('200 mg', 'tablet'), v('400 mg', 'tablet'), v('100 mg/5 ml', 'suspension')] },
  { name: 'Diclofenac', aka: 'voltaren', route: 'PO', variants: [v('50 mg', 'tablet'), v('75 mg/3 ml', 'injection', 'IM'), v('1%', 'gel', 'TOP')] },
  { name: 'Aspirin', route: 'PO', variants: [v('75 mg', 'tablet'), v('300 mg', 'tablet')] },
  { name: 'Tramadol', route: 'PO', variants: [v('50 mg', 'capsule')] },
  { name: 'Morphine', route: 'PO', variants: [v('10 mg/5 ml', 'oral solution'), v('10 mg/ml', 'injection', 'IV')] },
  { name: 'Prednisolone', route: 'PO', variants: [v('5 mg', 'tablet')] },
  { name: 'Dexamethasone', route: 'IV', variants: [v('4 mg/ml', 'injection'), v('0.5 mg', 'tablet', 'PO')] },
  { name: 'Hydrocortisone', route: 'IV', variants: [v('100 mg', 'injection'), v('1%', 'cream', 'TOP')] },

  // Stomach, gut and rehydration
  { name: 'Oral rehydration salts', aka: 'ors diarrhoea', route: 'PO', variants: [v('low osmolarity', 'sachet')] },
  { name: 'Zinc sulfate', aka: 'zinc diarrhoea', route: 'PO', variants: [v('20 mg dispersible', 'tablet')] },
  { name: 'Omeprazole', route: 'PO', variants: [v('20 mg', 'capsule'), v('40 mg', 'capsule')] },
  { name: 'Magnesium trisilicate', aka: 'antacid mist mag trisil', route: 'PO', variants: [v('500 mg', 'tablet'), v('500 mg/5 ml', 'suspension')] },
  { name: 'Hyoscine butylbromide', aka: 'buscopan', route: 'PO', variants: [v('10 mg', 'tablet'), v('20 mg/ml', 'injection', 'IV')] },
  { name: 'Metoclopramide', aka: 'plasil', route: 'PO', variants: [v('10 mg', 'tablet'), v('10 mg/2 ml', 'injection', 'IV')] },
  { name: 'Promethazine', aka: 'phenergan', route: 'PO', variants: [v('25 mg', 'tablet'), v('25 mg/ml', 'injection', 'IM')] },
  { name: 'Lactulose', route: 'PO', variants: [v('3.35 g/5 ml', 'syrup')] },

  // Breathing and allergy
  { name: 'Salbutamol', aka: 'ventolin asthma', route: 'INH', variants: [v('100 mcg/dose', 'inhaler'), v('2.5 mg/2.5 ml', 'nebuliser solution'), v('4 mg', 'tablet'), v('2 mg/5 ml', 'syrup')] },
  { name: 'Beclometasone', aka: 'asthma steroid inhaler', route: 'INH', variants: [v('100 mcg/dose', 'inhaler')] },
  { name: 'Chlorphenamine', aka: 'piriton allergy', route: 'PO', variants: [v('4 mg', 'tablet'), v('2 mg/5 ml', 'syrup')] },
  { name: 'Cetirizine', aka: 'zyrtec allergy', route: 'PO', variants: [v('10 mg', 'tablet'), v('5 mg/5 ml', 'syrup')] },
  { name: 'Loratadine', aka: 'allergy', route: 'PO', variants: [v('10 mg', 'tablet')] },

  // Heart, blood pressure and diabetes
  { name: 'Amlodipine', route: 'PO', variants: [v('5 mg', 'tablet'), v('10 mg', 'tablet')] },
  { name: 'Nifedipine', aka: 'preterm labour tocolysis', route: 'PO', variants: [v('10 mg', 'tablet'), v('20 mg retard', 'tablet'), v('10 mg', 'capsule')] },
  { name: 'Enalapril', route: 'PO', variants: [v('5 mg', 'tablet'), v('10 mg', 'tablet')] },
  { name: 'Lisinopril', route: 'PO', variants: [v('5 mg', 'tablet'), v('10 mg', 'tablet')] },
  { name: 'Atenolol', route: 'PO', variants: [v('50 mg', 'tablet'), v('100 mg', 'tablet')] },
  { name: 'Hydrochlorothiazide', aka: 'hctz diuretic', route: 'PO', variants: [v('25 mg', 'tablet')] },
  { name: 'Furosemide', aka: 'lasix frusemide diuretic', route: 'PO', variants: [v('40 mg', 'tablet'), v('20 mg/2 ml', 'injection', 'IV')] },
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
  { name: 'Diazepam', aka: 'valium', route: 'PO', variants: [v('5 mg', 'tablet'), v('10 mg/2 ml', 'injection', 'IV')] },
  { name: 'Phenobarbital', aka: 'phenobarbitone epilepsy', route: 'PO', variants: [v('30 mg', 'tablet'), v('60 mg', 'tablet')] },
  { name: 'Carbamazepine', aka: 'epilepsy', route: 'PO', variants: [v('200 mg', 'tablet')] },
  { name: 'Phenytoin', aka: 'epilepsy', route: 'PO', variants: [v('100 mg', 'tablet')] },
  { name: 'Amitriptyline', aka: 'depression', route: 'PO', variants: [v('25 mg', 'tablet')] },
  { name: 'Fluoxetine', aka: 'depression', route: 'PO', variants: [v('20 mg', 'capsule')] },
  { name: 'Haloperidol', route: 'PO', variants: [v('5 mg', 'tablet'), v('5 mg/ml', 'injection', 'IM')] },

  // Skin, wounds and local use
  { name: 'Silver sulfadiazine', aka: 'burns', route: 'TOP', variants: [v('1%', 'cream')] },
  { name: 'Calamine', aka: 'itching', route: 'TOP', variants: [v('standard', 'lotion')] },
  { name: 'Lidocaine', aka: 'lignocaine local anaesthetic', route: 'SC', variants: [v('2%', 'injection'), v('2%', 'gel', 'TOP')] },
  { name: 'Povidone iodine', aka: 'betadine antiseptic', route: 'TOP', variants: [v('10%', 'solution')] },
  { name: 'Tetanus toxoid', aka: 'tt vaccine', route: 'IM', variants: [v('0.5 ml', 'injection')] },
  { name: 'Miconazole', aka: 'daktarin fungal', route: 'TOP', variants: [v('2%', 'cream'), v('2%', 'gel')] },
  { name: 'Nystatin', aka: 'oral thrush candida', route: 'PO', variants: [v('100,000 IU/ml', 'suspension'), v('100,000 IU', 'pessary', 'PV')] },
  { name: 'Aciclovir', aka: 'acyclovir zovirax herpes zoster shingles', route: 'PO', variants: [v('200 mg', 'tablet'), v('400 mg', 'tablet'), v('800 mg', 'tablet'), v('5%', 'cream', 'TOP')] },
  { name: 'Griseofulvin', aka: 'ringworm tinea fungal', route: 'PO', variants: [v('500 mg', 'tablet'), v('125 mg', 'tablet')] },

  // IV fluids, electrolytes and blood
  { name: 'Normal saline', aka: 'sodium chloride ns iv fluid infusion drip', route: 'IV', variants: [v('0.9%', 'infusion')] },
  { name: 'Dextrose', aka: 'glucose d5 d10 d50 iv fluid infusion drip hypoglycaemia', route: 'IV', variants: [v('5%', 'infusion'), v('10%', 'infusion'), v('50%', 'injection')] },
  { name: "Ringer's lactate", aka: 'ringers lactate hartmann hartmanns compound sodium lactate rl iv fluid infusion drip', route: 'IV', variants: [v('compound sodium lactate', 'infusion')] },
  { name: 'Dextrose/Sodium chloride', aka: 'dextrose saline dns iv fluid infusion drip', route: 'IV', variants: [v('5%/0.9%', 'infusion'), v('5%/0.45%', 'infusion')] },
  { name: 'Darrow solution', aka: 'half strength darrows dextrose iv fluid paediatric', route: 'IV', variants: [v('half strength with 2.5% dextrose', 'infusion')] },
  { name: 'Potassium chloride', aka: 'kcl hypokalaemia', route: 'IV', variants: [v('15% (2 mmol/ml)', 'injection'), v('600 mg slow release', 'tablet', 'PO')] },
  { name: 'Calcium gluconate', aka: 'hypocalcaemia magnesium toxicity', route: 'IV', variants: [v('10%', 'injection')] },
  { name: 'Sodium bicarbonate', aka: 'acidosis', route: 'IV', variants: [v('8.4%', 'injection')] },
  { name: 'Water for injection', aka: 'wfi diluent', route: 'IV', variants: [v('10 ml', 'injection')] },
  { name: 'Mannitol', aka: 'raised intracranial pressure', route: 'IV', variants: [v('20%', 'infusion')] },
  { name: 'Gelatin (succinylated)', aka: 'gelofusine haemaccel plasma expander colloid', route: 'IV', variants: [v('4%', 'infusion')] },

  // Emergency, anaesthesia and theatre
  { name: 'Adrenaline', aka: 'epinephrine anaphylaxis cardiac arrest', route: 'IM', variants: [v('1 mg/ml (1:1000)', 'injection')] },
  { name: 'Atropine', aka: 'bradycardia organophosphate premedication', route: 'IV', variants: [v('0.6 mg/ml', 'injection')] },
  { name: 'Aminophylline', aka: 'asthma bronchospasm', route: 'IV', variants: [v('25 mg/ml', 'injection'), v('100 mg', 'tablet', 'PO')] },
  { name: 'Ketamine', aka: 'anaesthesia', route: 'IV', variants: [v('50 mg/ml', 'injection')] },
  { name: 'Pethidine', aka: 'meperidine pain analgesia', route: 'IM', variants: [v('50 mg/ml', 'injection')] },
  { name: 'Ondansetron', aka: 'zofran nausea vomiting', route: 'IV', variants: [v('2 mg/ml', 'injection'), v('4 mg', 'tablet', 'PO'), v('8 mg', 'tablet', 'PO')] },
  { name: 'Tranexamic acid', aka: 'txa bleeding pph trauma', route: 'IV', variants: [v('100 mg/ml', 'injection'), v('500 mg', 'tablet', 'PO')] },
  { name: 'Phytomenadione', aka: 'vitamin k newborn bleeding warfarin', route: 'IM', variants: [v('1 mg/0.5 ml', 'injection'), v('10 mg/ml', 'injection')] },
  { name: 'Glyceryl trinitrate', aka: 'gtn nitroglycerin angina', route: 'SL', variants: [v('0.5 mg', 'tablet')] },
  { name: 'Esomeprazole', aka: 'nexium ulcer bleeding', route: 'IV', variants: [v('40 mg', 'injection'), v('20 mg', 'tablet', 'PO'), v('40 mg', 'tablet', 'PO')] },

  // More antibiotics
  { name: 'Cefuroxime', aka: 'zinnat zinacef', route: 'PO', variants: [v('250 mg', 'tablet'), v('500 mg', 'tablet'), v('750 mg', 'injection', 'IV')] },
  { name: 'Cloxacillin', aka: 'orbenin', route: 'PO', variants: [v('250 mg', 'capsule'), v('500 mg', 'capsule'), v('500 mg', 'injection', 'IV')] },
  { name: 'Clindamycin', aka: 'dalacin', route: 'PO', variants: [v('150 mg', 'capsule'), v('300 mg', 'capsule'), v('150 mg/ml', 'injection', 'IV')] },
  { name: 'Benzathine benzylpenicillin', aka: 'penadur syphilis rheumatic', route: 'IM', variants: [v('2.4 MU', 'injection')] },
  { name: 'Procaine benzylpenicillin', aka: 'ppf procaine penicillin', route: 'IM', variants: [v('3 MU', 'injection')] },
  { name: 'Levofloxacin', aka: 'tavanic', route: 'PO', variants: [v('500 mg', 'tablet'), v('750 mg', 'tablet')] },
  { name: 'Tinidazole', aka: 'fasigyn', route: 'PO', variants: [v('500 mg', 'tablet')] },
  { name: 'Meropenem', aka: 'meronem carbapenem', route: 'IV', variants: [v('500 mg', 'injection'), v('1 g', 'injection')] },
  { name: 'Amikacin', route: 'IV', variants: [v('500 mg/2 ml', 'injection')] },
  { name: 'Artemether', aka: 'paluther severe malaria', route: 'IM', variants: [v('80 mg/ml', 'injection'), v('20 mg/ml', 'injection')] },

  // More heart, blood pressure, blood and diabetes
  { name: 'Hydralazine', aka: 'apresoline pre-eclampsia severe hypertension', route: 'IV', variants: [v('20 mg/ml', 'injection'), v('25 mg', 'tablet', 'PO'), v('50 mg', 'tablet', 'PO')] },
  { name: 'Labetalol', aka: 'trandate pre-eclampsia severe hypertension', route: 'IV', variants: [v('5 mg/ml', 'injection'), v('100 mg', 'tablet', 'PO'), v('200 mg', 'tablet', 'PO')] },
  { name: 'Losartan', aka: 'cozaar', route: 'PO', variants: [v('50 mg', 'tablet'), v('100 mg', 'tablet')] },
  { name: 'Carvedilol', route: 'PO', variants: [v('6.25 mg', 'tablet'), v('12.5 mg', 'tablet'), v('25 mg', 'tablet')] },
  { name: 'Bisoprolol', aka: 'concor', route: 'PO', variants: [v('2.5 mg', 'tablet'), v('5 mg', 'tablet')] },
  { name: 'Propranolol', aka: 'inderal', route: 'PO', variants: [v('10 mg', 'tablet'), v('40 mg', 'tablet')] },
  { name: 'Spironolactone', aka: 'aldactone diuretic', route: 'PO', variants: [v('25 mg', 'tablet'), v('100 mg', 'tablet')] },
  { name: 'Digoxin', aka: 'lanoxin heart failure atrial fibrillation', route: 'PO', variants: [v('0.25 mg', 'tablet'), v('62.5 mcg', 'tablet')] },
  { name: 'Atorvastatin', aka: 'lipitor statin cholesterol', route: 'PO', variants: [v('10 mg', 'tablet'), v('20 mg', 'tablet'), v('40 mg', 'tablet')] },
  { name: 'Clopidogrel', aka: 'plavix', route: 'PO', variants: [v('75 mg', 'tablet')] },
  { name: 'Warfarin', route: 'PO', variants: [v('1 mg', 'tablet'), v('5 mg', 'tablet')] },
  { name: 'Heparin', aka: 'unfractionated anticoagulant', route: 'SC', variants: [v('5,000 IU/ml', 'injection')] },
  { name: 'Enoxaparin', aka: 'clexane lmwh anticoagulant dvt', route: 'SC', variants: [v('40 mg/0.4 ml', 'injection'), v('60 mg/0.6 ml', 'injection')] },
  { name: 'Gliclazide', aka: 'diamicron diabetes', route: 'PO', variants: [v('80 mg', 'tablet'), v('30 mg modified release', 'tablet')] },
  { name: 'Insulin (premixed 30/70)', aka: 'mixtard biphasic diabetes', route: 'SC', variants: [v('100 IU/ml', 'injection')] },

  // More pregnancy and childbirth
  { name: 'Ergometrine', aka: 'pph', route: 'IM', variants: [v('0.5 mg/ml', 'injection')] },
  { name: 'Calcium carbonate', aka: 'calcium pregnancy pre-eclampsia', route: 'PO', variants: [v('500 mg', 'tablet'), v('1.25 g', 'tablet')] },

  // More stomach and gut
  { name: 'Bisacodyl', aka: 'dulcolax constipation', route: 'PO', variants: [v('5 mg', 'tablet'), v('10 mg', 'suppository', 'PR')] },
  { name: 'Loperamide', aka: 'imodium diarrhoea', route: 'PO', variants: [v('2 mg', 'capsule')] },

  // More nervous system and mental health
  { name: 'Sodium valproate', aka: 'epilim epilepsy', route: 'PO', variants: [v('200 mg', 'tablet'), v('500 mg', 'tablet'), v('200 mg/5 ml', 'syrup')] },
  { name: 'Levetiracetam', aka: 'keppra epilepsy', route: 'PO', variants: [v('250 mg', 'tablet'), v('500 mg', 'tablet')] },
  { name: 'Chlorpromazine', aka: 'largactil', route: 'PO', variants: [v('25 mg', 'tablet'), v('100 mg', 'tablet'), v('25 mg/ml', 'injection', 'IM')] },
  { name: 'Risperidone', route: 'PO', variants: [v('1 mg', 'tablet'), v('2 mg', 'tablet')] },
  { name: 'Olanzapine', route: 'PO', variants: [v('5 mg', 'tablet'), v('10 mg', 'tablet')] },

  // More pain, inflammation and muscle relaxants
  { name: 'Etoricoxib', aka: 'arcoxia nucoxia brutaflam cox-2 nsaid', route: 'PO', variants: [v('60 mg', 'tablet'), v('90 mg', 'tablet'), v('120 mg', 'tablet')] },
  { name: 'Tramadol/Paracetamol', aka: 'trap ultracet tramadol panadol', route: 'PO', variants: [v('37.5/325 mg', 'tablet')] },
  { name: 'Chlorzoxazone/Paracetamol', aka: 'myospaz muscle relaxant', route: 'PO', variants: [v('', 'tablet')] },

  // More heart, blood pressure and diabetes
  { name: 'Telmisartan', aka: 'telvas micardis', route: 'PO', variants: [v('40 mg', 'tablet'), v('80 mg', 'tablet')] },
  { name: 'Telmisartan/Hydrochlorothiazide', aka: 'telvas-h telvas h micardis plus', route: 'PO', variants: [v('40/12.5 mg', 'tablet'), v('80/12.5 mg', 'tablet')] },
  { name: 'Losartan/Hydrochlorothiazide', aka: 'losartan-h losartan h hyzaar', route: 'PO', variants: [v('50/12.5 mg', 'tablet')] },
  { name: 'Nebivolol', aka: 'nebilong nebilet beta blocker', route: 'PO', variants: [v('5 mg', 'tablet')] },
  { name: 'Nebivolol/Hydrochlorothiazide', aka: 'nebilong-h nebilong h', route: 'PO', variants: [v('5/12.5 mg', 'tablet')] },
  { name: 'Dapagliflozin', aka: 'forxiga dapaglifozin sglt2 diabetes', route: 'PO', variants: [v('5 mg', 'tablet'), v('10 mg', 'tablet')] },
  { name: 'Dapagliflozin/Metformin', aka: 'dapagliflozin-m plus dapa m xigduo diabetes', route: 'PO', variants: [v('10/1000 mg', 'tablet')] },
  { name: 'Glimepiride', aka: 'diapride amaryl diabetes', route: 'PO', variants: [v('1 mg', 'tablet'), v('2 mg', 'tablet'), v('4 mg', 'tablet')] },
  { name: 'Glimepiride/Metformin', aka: 'diapride plus diapride m amaryl m diabetes', route: 'PO', variants: [v('1/500 mg', 'tablet'), v('2/500 mg', 'tablet')] },

  // More stomach, antibiotics, allergy and vitamins
  { name: 'Omeprazole/Domperidone', aka: 'limzar', route: 'PO', variants: [v('20/10 mg', 'capsule')] },
  { name: 'Amoxicillin/Flucloxacillin', aka: 'flucamox ampiclox penicillin', route: 'PO', variants: [v('250/250 mg', 'capsule')] },
  { name: 'Doxylamine/Pyridoxine', aka: 'vomi-6 vomiting pregnancy nausea', route: 'PO', variants: [v('10/10 mg', 'tablet')] },
  { name: 'Chlorphenamine/Paracetamol/Vitamin C', aka: 'apfu piriton panadol cold flu syrup', route: 'PO', variants: [v('', 'syrup')] },
  { name: 'Vitamin B1/B6/B12', aka: 'neurobion neurobine neuroforte neurotropic thiamine pyridoxine cyanocobalamin', route: 'PO', variants: [v('', 'tablet')] },

  // Brands asked for by facilities. The contents are in the name where known, so the
  // pharmacist knows what is meant and allergy checks see them (Flucamox holds amoxicillin).
  { name: 'Nucoxia (Etoricoxib)', aka: 'nucoxia', route: 'PO', variants: [v('60 mg', 'tablet'), v('90 mg', 'tablet'), v('120 mg', 'tablet')] },
  { name: 'Brutaflam (Etoricoxib)', aka: 'brutaflam', route: 'PO', variants: [v('60 mg', 'tablet'), v('90 mg', 'tablet'), v('120 mg', 'tablet')] },
  { name: 'TRAP (Tramadol/Paracetamol)', aka: 'trap', route: 'PO', variants: [v('37.5/325 mg', 'tablet')] },
  { name: 'Dynapar (Diclofenac)', aka: 'dynapar aq', route: 'PO', variants: [v('50 mg', 'tablet'), v('75 mg/ml', 'injection', 'IM')] },
  { name: 'Myospaz (Chlorzoxazone/Paracetamol)', aka: 'myospaz', route: 'PO', variants: [v('', 'tablet')] },
  { name: 'Flexilor', aka: 'flexilor', route: 'PO', variants: [v('', 'tablet')] },
  { name: 'Flexilor SR', aka: 'flexilor sr', route: 'PO', variants: [v('', 'tablet')] },
  { name: 'Flexion MR', aka: 'flexion mr flexon mr', route: 'PO', variants: [v('', 'tablet')] },
  { name: 'Telvas (Telmisartan)', aka: 'telvas', route: 'PO', variants: [v('40 mg', 'tablet'), v('80 mg', 'tablet')] },
  { name: 'Telvas-H (Telmisartan/Hydrochlorothiazide)', aka: 'telvas-h telvas h', route: 'PO', variants: [v('40/12.5 mg', 'tablet'), v('80/12.5 mg', 'tablet')] },
  { name: 'Nebilong (Nebivolol)', aka: 'nebilong', route: 'PO', variants: [v('5 mg', 'tablet')] },
  { name: 'Nebilong-H (Nebivolol/Hydrochlorothiazide)', aka: 'nebilong-h nebilong h', route: 'PO', variants: [v('5/12.5 mg', 'tablet')] },
  { name: 'Dapagliflozin-M Plus (Dapagliflozin/Metformin)', aka: 'dapaglifozin m plus dapa', route: 'PO', variants: [v('10/1000 mg', 'tablet')] },
  { name: 'Diapride (Glimepiride)', aka: 'diapride', route: 'PO', variants: [v('2 mg', 'tablet'), v('4 mg', 'tablet')] },
  { name: 'Diapride Plus (Glimepiride/Metformin)', aka: 'diapride plus diapride m', route: 'PO', variants: [v('', 'tablet')] },
  { name: 'Limzar (Omeprazole/Domperidone)', aka: 'limzar', route: 'PO', variants: [v('20/10 mg', 'capsule')] },
  { name: 'Flucamox (Amoxicillin/Flucloxacillin)', aka: 'flucamox', route: 'PO', variants: [v('250/250 mg', 'capsule')] },
  { name: 'APFU (Chlorphenamine/Paracetamol/Vitamin C)', aka: 'apfu piriton panadol', route: 'PO', variants: [v('', 'syrup')] },
  { name: 'Vomi-6', aka: 'vomi 6 vomi-6 doxylamine pyridoxine vomiting', route: 'PO', variants: [v('', 'tablet')] },
  { name: 'Neurobine (Vitamin B1/B6/B12)', aka: 'neurobine neurobion', route: 'PO', variants: [v('', 'tablet')] },
  { name: 'Neuroforte (Vitamin B1/B6/B12)', aka: 'neuroforte', route: 'PO', variants: [v('', 'tablet')] },
  { name: 'Neurotone', aka: 'neurotone neurtone', route: 'PO', variants: [v('', 'tablet')] },
  { name: 'NAT B', aka: 'nat b natb', route: 'PO', variants: [v('', 'capsule')] },
  { name: 'Koff-Go', aka: 'koff go koffgo cough', route: 'PO', variants: [v('', 'syrup')] },
  { name: 'Apidone', aka: 'apidone', route: 'PO', variants: [v('', 'syrup')] },
  { name: 'SK-Derm', aka: 'sk derm skderm', route: 'TOP', variants: [v('15 g', 'cream'), v('30 g', 'cream')] },
  { name: 'MCG', aka: 'mcg cream', route: 'TOP', variants: [v('15 g', 'cream')] },
];

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const sameVariant = (a: CatalogVariant, b: CatalogVariant) =>
  a.form === b.form && a.strength.replace(/\s+/g, '').toLowerCase() === b.strength.replace(/\s+/g, '').toLowerCase();

/**
 * The prescribing list with the national list folded in: a medicine on both is
 * listed once, with the national list's other strengths and forms added (and
 * its search words); a medicine only on the national list is added whole.
 */
export function withNationalList(list: CatalogMedicine[], national: CatalogMedicine[]): CatalogMedicine[] {
  const merged = list.map((m) => ({ ...m, variants: [...m.variants] }));
  for (const n of national) {
    const existing = merged.find((m) => sameName(m.name, n.name));
    if (!existing) {
      merged.push({ ...n, variants: [...n.variants], nationalList: true });
      continue;
    }
    existing.nationalList = true;
    for (const variant of n.variants) {
      if (existing.variants.some((x) => sameVariant(x, variant))) continue;
      const route = variant.route ?? n.route;
      existing.variants.push(route === existing.route ? v(variant.strength, variant.form) : v(variant.strength, variant.form, route));
    }
    const words = (n.aka ?? '').split(/\s+/).filter((w) => w && !(existing.aka ?? '').toLowerCase().split(/\s+/).includes(w.toLowerCase()));
    if (words.length) existing.aka = [existing.aka, ...words].filter(Boolean).join(' ');
  }
  return merged;
}

export const MEDICINES_CATALOG: CatalogMedicine[] = withNationalList(PRESCRIBING_LIST, NATIONAL_MEDICINES);

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
