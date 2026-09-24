// A curated subset of ICD-10 (WHO) - the conditions most often seen in Ugandan
// outpatient and primary care - bundled so diagnosis coding works offline. It is
// a convenience, not a limit: the recording screen also takes any other valid
// ICD-10 code typed in by hand (the server checks the format).
//
// Codes are used for HMIS 105 reporting (see apps/backend/src/lib/clinical.ts,
// classifyHmisCondition), so a code chosen here decides which surveillance line
// a visit counts under.

export type Icd10Entry = {
  code: string;
  name: string;
  group: string;
  /** Other names people search by (abbreviations, local and brand terms). */
  keywords?: string;
};

export const ICD10_PATTERN = /^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/;

export const ICD10_COMMON: Icd10Entry[] = [
  // Malaria and fevers
  { code: 'B50.9', name: 'Malaria, P. falciparum, unspecified', group: 'Malaria and fever', keywords: 'malaria falciparum mp rdt positive' },
  { code: 'B50.0', name: 'Cerebral malaria (P. falciparum with cerebral complications)', group: 'Malaria and fever', keywords: 'severe malaria coma' },
  { code: 'B50.8', name: 'Severe and complicated malaria (P. falciparum)', group: 'Malaria and fever', keywords: 'severe malaria' },
  { code: 'B51.9', name: 'Malaria, P. vivax, without complication', group: 'Malaria and fever', keywords: 'vivax' },
  { code: 'B54', name: 'Malaria, unspecified', group: 'Malaria and fever', keywords: 'malaria clinical' },
  { code: 'R50.9', name: 'Fever, unspecified', group: 'Malaria and fever', keywords: 'pyrexia puo fever of unknown origin' },
  { code: 'A01.0', name: 'Typhoid fever', group: 'Malaria and fever', keywords: 'enteric fever salmonella' },
  { code: 'A41.9', name: 'Sepsis, unspecified', group: 'Malaria and fever', keywords: 'septicaemia' },

  // Respiratory
  { code: 'J06.9', name: 'Acute upper respiratory infection, unspecified', group: 'Respiratory', keywords: 'urti uri cold flu' },
  { code: 'J00', name: 'Acute nasopharyngitis (common cold)', group: 'Respiratory', keywords: 'cold coryza' },
  { code: 'J02.9', name: 'Acute pharyngitis, unspecified', group: 'Respiratory', keywords: 'sore throat' },
  { code: 'J03.9', name: 'Acute tonsillitis, unspecified', group: 'Respiratory', keywords: 'tonsils' },
  { code: 'J01.9', name: 'Acute sinusitis, unspecified', group: 'Respiratory' },
  { code: 'J18.9', name: 'Pneumonia, unspecified', group: 'Respiratory', keywords: 'chest infection lrti' },
  { code: 'J15.9', name: 'Bacterial pneumonia, unspecified', group: 'Respiratory' },
  { code: 'J20.9', name: 'Acute bronchitis, unspecified', group: 'Respiratory' },
  { code: 'J21.9', name: 'Acute bronchiolitis, unspecified', group: 'Respiratory' },
  { code: 'J22', name: 'Acute lower respiratory infection, unspecified', group: 'Respiratory', keywords: 'lrti sari' },
  { code: 'J40', name: 'Bronchitis, not specified as acute or chronic', group: 'Respiratory' },
  { code: 'J45.9', name: 'Asthma, unspecified', group: 'Respiratory', keywords: 'wheeze' },
  { code: 'J44.9', name: 'Chronic obstructive pulmonary disease, unspecified', group: 'Respiratory', keywords: 'copd' },
  { code: 'J30.4', name: 'Allergic rhinitis, unspecified', group: 'Respiratory', keywords: 'hay fever' },
  { code: 'R05', name: 'Cough', group: 'Respiratory' },
  { code: 'R06.0', name: 'Dyspnoea (difficulty breathing)', group: 'Respiratory', keywords: 'shortness of breath sob' },
  { code: 'U07.1', name: 'COVID-19, virus identified', group: 'Respiratory', keywords: 'coronavirus' },
  { code: 'A37.9', name: 'Whooping cough, unspecified', group: 'Respiratory', keywords: 'pertussis' },

  // Gastrointestinal and infections of the gut
  { code: 'A09', name: 'Diarrhoea and gastroenteritis of presumed infectious origin', group: 'Gastrointestinal', keywords: 'diarrhea gastroenteritis' },
  { code: 'A03.9', name: 'Shigellosis (bacillary dysentery), unspecified', group: 'Gastrointestinal', keywords: 'dysentery bloody diarrhoea' },
  { code: 'A06.0', name: 'Acute amoebic dysentery', group: 'Gastrointestinal', keywords: 'amoebiasis dysentery' },
  { code: 'A00.9', name: 'Cholera, unspecified', group: 'Gastrointestinal' },
  { code: 'A07.1', name: 'Giardiasis', group: 'Gastrointestinal' },
  { code: 'K29.7', name: 'Gastritis, unspecified', group: 'Gastrointestinal' },
  { code: 'K30', name: 'Functional dyspepsia', group: 'Gastrointestinal', keywords: 'indigestion' },
  { code: 'K27.9', name: 'Peptic ulcer, site unspecified', group: 'Gastrointestinal', keywords: 'pud ulcer' },
  { code: 'K21.9', name: 'Gastro-oesophageal reflux disease', group: 'Gastrointestinal', keywords: 'gerd reflux heartburn' },
  { code: 'K59.0', name: 'Constipation', group: 'Gastrointestinal' },
  { code: 'K52.9', name: 'Non-infective gastroenteritis and colitis, unspecified', group: 'Gastrointestinal' },
  { code: 'K37', name: 'Appendicitis, unspecified', group: 'Gastrointestinal' },
  { code: 'K40.9', name: 'Inguinal hernia, without obstruction or gangrene', group: 'Gastrointestinal', keywords: 'hernia' },
  { code: 'R10.4', name: 'Abdominal pain, other and unspecified', group: 'Gastrointestinal', keywords: 'stomach ache' },
  { code: 'R11', name: 'Nausea and vomiting', group: 'Gastrointestinal' },
  { code: 'R19.7', name: 'Diarrhoea, unspecified', group: 'Gastrointestinal' },
  { code: 'E86', name: 'Dehydration (volume depletion)', group: 'Gastrointestinal' },

  // Worms and parasites
  { code: 'B82.9', name: 'Intestinal parasitism, unspecified (worms)', group: 'Parasites', keywords: 'worms helminths' },
  { code: 'B76.9', name: 'Hookworm disease, unspecified', group: 'Parasites' },
  { code: 'B77.9', name: 'Ascariasis, unspecified (roundworm)', group: 'Parasites' },
  { code: 'B65.9', name: 'Schistosomiasis, unspecified', group: 'Parasites', keywords: 'bilharzia' },
  { code: 'B73', name: 'Onchocerciasis', group: 'Parasites', keywords: 'river blindness' },
  { code: 'B56.9', name: 'African trypanosomiasis, unspecified', group: 'Parasites', keywords: 'sleeping sickness' },

  // HIV, TB and other serious infections
  { code: 'B20', name: 'HIV disease resulting in infectious and parasitic diseases', group: 'HIV, TB and other infections', keywords: 'hiv aids' },
  { code: 'B24', name: 'HIV disease, unspecified', group: 'HIV, TB and other infections', keywords: 'hiv aids' },
  { code: 'Z21', name: 'Asymptomatic HIV infection status', group: 'HIV, TB and other infections', keywords: 'hiv positive on art' },
  { code: 'A15.0', name: 'Tuberculosis of lung, confirmed by sputum microscopy', group: 'HIV, TB and other infections', keywords: 'tb pulmonary afb positive' },
  { code: 'A16.2', name: 'Tuberculosis of lung, without bacteriological confirmation', group: 'HIV, TB and other infections', keywords: 'tb clinically diagnosed' },
  { code: 'B05.9', name: 'Measles, without complication', group: 'HIV, TB and other infections' },
  { code: 'B01.9', name: 'Varicella (chickenpox), without complication', group: 'HIV, TB and other infections', keywords: 'chicken pox' },
  { code: 'G00.9', name: 'Bacterial meningitis, unspecified', group: 'HIV, TB and other infections' },
  { code: 'A39.0', name: 'Meningococcal meningitis', group: 'HIV, TB and other infections' },
  { code: 'G03.9', name: 'Meningitis, unspecified', group: 'HIV, TB and other infections' },
  { code: 'B15.9', name: 'Hepatitis A, without hepatic coma', group: 'HIV, TB and other infections' },
  { code: 'B16.9', name: 'Acute hepatitis B, without delta-agent or coma', group: 'HIV, TB and other infections' },
  { code: 'B18.1', name: 'Chronic viral hepatitis B', group: 'HIV, TB and other infections' },
  { code: 'B19.9', name: 'Viral hepatitis, unspecified, without hepatic coma', group: 'HIV, TB and other infections', keywords: 'jaundice' },
  { code: 'A35', name: 'Tetanus', group: 'HIV, TB and other infections' },
  { code: 'A23.9', name: 'Brucellosis, unspecified', group: 'HIV, TB and other infections' },
  { code: 'A22.9', name: 'Anthrax, unspecified', group: 'HIV, TB and other infections' },
  { code: 'A30.9', name: 'Leprosy, unspecified', group: 'HIV, TB and other infections' },

  // Sexual and reproductive health
  { code: 'A54.9', name: 'Gonococcal infection, unspecified', group: 'Sexual and reproductive health', keywords: 'gonorrhoea std sti' },
  { code: 'A56.0', name: 'Chlamydial infection of lower genitourinary tract', group: 'Sexual and reproductive health', keywords: 'chlamydia sti' },
  { code: 'A53.9', name: 'Syphilis, unspecified', group: 'Sexual and reproductive health', keywords: 'sti' },
  { code: 'A60.9', name: 'Anogenital herpesviral infection, unspecified', group: 'Sexual and reproductive health', keywords: 'genital herpes' },
  { code: 'A64', name: 'Sexually transmitted disease, unspecified', group: 'Sexual and reproductive health', keywords: 'sti std' },
  { code: 'N76.0', name: 'Acute vaginitis', group: 'Sexual and reproductive health', keywords: 'vaginal discharge' },
  { code: 'B37.3', name: 'Candidiasis of vulva and vagina', group: 'Sexual and reproductive health', keywords: 'thrush yeast' },
  { code: 'N73.9', name: 'Female pelvic inflammatory disease, unspecified', group: 'Sexual and reproductive health', keywords: 'pid' },
  { code: 'N94.6', name: 'Dysmenorrhoea, unspecified', group: 'Sexual and reproductive health', keywords: 'period pain' },
  { code: 'N97.9', name: 'Female infertility, unspecified', group: 'Sexual and reproductive health' },
  { code: 'Z30.0', name: 'General counselling and advice on contraception', group: 'Sexual and reproductive health', keywords: 'family planning' },
  { code: 'Z30.9', name: 'Contraceptive management, unspecified', group: 'Sexual and reproductive health', keywords: 'family planning' },

  // Pregnancy, childbirth and the newborn
  { code: 'Z34.9', name: 'Supervision of normal pregnancy, unspecified', group: 'Pregnancy and newborn', keywords: 'anc antenatal' },
  { code: 'Z34.0', name: 'Supervision of normal first pregnancy', group: 'Pregnancy and newborn', keywords: 'anc antenatal' },
  { code: 'O80', name: 'Single spontaneous delivery', group: 'Pregnancy and newborn', keywords: 'svd normal delivery' },
  { code: 'O14.9', name: 'Pre-eclampsia, unspecified', group: 'Pregnancy and newborn' },
  { code: 'O15.9', name: 'Eclampsia, unspecified', group: 'Pregnancy and newborn' },
  { code: 'O03.9', name: 'Spontaneous abortion, complete or unspecified, without complication', group: 'Pregnancy and newborn', keywords: 'miscarriage' },
  { code: 'O20.9', name: 'Haemorrhage in early pregnancy, unspecified', group: 'Pregnancy and newborn', keywords: 'bleeding' },
  { code: 'O72.1', name: 'Other immediate postpartum haemorrhage', group: 'Pregnancy and newborn', keywords: 'pph' },
  { code: 'O23.4', name: 'Unspecified infection of urinary tract in pregnancy', group: 'Pregnancy and newborn', keywords: 'uti pregnancy' },
  { code: 'O99.0', name: 'Anaemia complicating pregnancy, childbirth and the puerperium', group: 'Pregnancy and newborn' },
  { code: 'O47.9', name: 'False labour, unspecified', group: 'Pregnancy and newborn' },
  { code: 'Z39.2', name: 'Routine postpartum follow-up', group: 'Pregnancy and newborn', keywords: 'pnc postnatal' },
  { code: 'P36.9', name: 'Bacterial sepsis of newborn, unspecified', group: 'Pregnancy and newborn', keywords: 'neonatal sepsis' },
  { code: 'P59.9', name: 'Neonatal jaundice, unspecified', group: 'Pregnancy and newborn' },
  { code: 'P22.9', name: 'Respiratory distress of newborn, unspecified', group: 'Pregnancy and newborn' },
  { code: 'Z23', name: 'Need for immunisation', group: 'Pregnancy and newborn', keywords: 'vaccine vaccination epi' },
  { code: 'Z00.1', name: 'Routine child health examination', group: 'Pregnancy and newborn', keywords: 'child welfare growth monitoring' },

  // Nutrition and blood
  { code: 'D64.9', name: 'Anaemia, unspecified', group: 'Nutrition and blood', keywords: 'pallor low hb' },
  { code: 'D50.9', name: 'Iron deficiency anaemia, unspecified', group: 'Nutrition and blood' },
  { code: 'D57.1', name: 'Sickle-cell disease without crisis', group: 'Nutrition and blood', keywords: 'sca' },
  { code: 'D57.0', name: 'Sickle-cell disease with crisis', group: 'Nutrition and blood', keywords: 'sca crisis' },
  { code: 'E46', name: 'Protein-energy malnutrition, unspecified', group: 'Nutrition and blood', keywords: 'pem malnutrition' },
  { code: 'E43', name: 'Severe protein-energy malnutrition, unspecified', group: 'Nutrition and blood', keywords: 'sam kwashiorkor marasmus' },
  { code: 'E44.0', name: 'Moderate protein-energy malnutrition', group: 'Nutrition and blood', keywords: 'mam' },
  { code: 'E50.9', name: 'Vitamin A deficiency, unspecified', group: 'Nutrition and blood' },
  { code: 'E55.9', name: 'Vitamin D deficiency, unspecified', group: 'Nutrition and blood' },
  { code: 'E66.9', name: 'Obesity, unspecified', group: 'Nutrition and blood' },

  // Heart, blood pressure, diabetes and hormones
  { code: 'I10', name: 'Essential (primary) hypertension', group: 'Heart and metabolic', keywords: 'high blood pressure htn' },
  { code: 'I50.9', name: 'Heart failure, unspecified', group: 'Heart and metabolic' },
  { code: 'I20.9', name: 'Angina pectoris, unspecified', group: 'Heart and metabolic' },
  { code: 'I64', name: 'Stroke, not specified as haemorrhage or infarction', group: 'Heart and metabolic', keywords: 'cva' },
  { code: 'E11.9', name: 'Type 2 diabetes mellitus, without complications', group: 'Heart and metabolic', keywords: 'dm diabetes' },
  { code: 'E10.9', name: 'Type 1 diabetes mellitus, without complications', group: 'Heart and metabolic', keywords: 'dm diabetes' },
  { code: 'E14.9', name: 'Diabetes mellitus, unspecified, without complications', group: 'Heart and metabolic', keywords: 'dm diabetes' },
  { code: 'E16.2', name: 'Hypoglycaemia, unspecified', group: 'Heart and metabolic', keywords: 'low blood sugar' },
  { code: 'E03.9', name: 'Hypothyroidism, unspecified', group: 'Heart and metabolic' },
  { code: 'E05.9', name: 'Thyrotoxicosis, unspecified', group: 'Heart and metabolic', keywords: 'hyperthyroidism' },
  { code: 'R60.9', name: 'Oedema, unspecified', group: 'Heart and metabolic', keywords: 'swelling' },

  // Urinary and kidney
  { code: 'N39.0', name: 'Urinary tract infection, site not specified', group: 'Urinary and kidney', keywords: 'uti' },
  { code: 'N30.0', name: 'Acute cystitis', group: 'Urinary and kidney' },
  { code: 'N10', name: 'Acute pyelonephritis', group: 'Urinary and kidney' },
  { code: 'N20.0', name: 'Calculus of kidney', group: 'Urinary and kidney', keywords: 'kidney stone' },
  { code: 'N40', name: 'Hyperplasia of prostate', group: 'Urinary and kidney', keywords: 'bph enlarged prostate' },
  { code: 'N17.9', name: 'Acute kidney failure, unspecified', group: 'Urinary and kidney' },
  { code: 'N18.9', name: 'Chronic kidney disease, unspecified', group: 'Urinary and kidney', keywords: 'ckd' },
  { code: 'R30.0', name: 'Dysuria (painful urination)', group: 'Urinary and kidney' },
  { code: 'R31', name: 'Haematuria, unspecified', group: 'Urinary and kidney', keywords: 'blood in urine' },

  // Skin
  { code: 'B35.9', name: 'Dermatophytosis, unspecified (ringworm)', group: 'Skin', keywords: 'tinea fungal' },
  { code: 'B36.0', name: 'Pityriasis versicolor', group: 'Skin' },
  { code: 'B37.9', name: 'Candidiasis, unspecified', group: 'Skin', keywords: 'thrush' },
  { code: 'B86', name: 'Scabies', group: 'Skin' },
  { code: 'B85.0', name: 'Pediculosis due to head lice', group: 'Skin', keywords: 'lice' },
  { code: 'L30.9', name: 'Dermatitis, unspecified', group: 'Skin', keywords: 'eczema' },
  { code: 'L20.9', name: 'Atopic dermatitis, unspecified', group: 'Skin', keywords: 'eczema' },
  { code: 'L23.9', name: 'Allergic contact dermatitis, unspecified cause', group: 'Skin' },
  { code: 'L02.9', name: 'Cutaneous abscess, furuncle and carbuncle, unspecified', group: 'Skin', keywords: 'boil abscess' },
  { code: 'L03.9', name: 'Cellulitis, unspecified', group: 'Skin' },
  { code: 'L01.0', name: 'Impetigo', group: 'Skin' },
  { code: 'L50.9', name: 'Urticaria, unspecified', group: 'Skin', keywords: 'hives' },
  { code: 'L70.0', name: 'Acne vulgaris', group: 'Skin' },
  { code: 'L29.9', name: 'Pruritus, unspecified', group: 'Skin', keywords: 'itching' },
  { code: 'R21', name: 'Rash and other nonspecific skin eruption', group: 'Skin' },
  { code: 'T30.0', name: 'Burn, unspecified degree, unspecified body region', group: 'Skin' },

  // Eye, ear, nose and mouth
  { code: 'H66.9', name: 'Otitis media, unspecified', group: 'Eye, ear and mouth', keywords: 'ear infection' },
  { code: 'H60.9', name: 'Otitis externa, unspecified', group: 'Eye, ear and mouth' },
  { code: 'H61.2', name: 'Impacted cerumen (ear wax)', group: 'Eye, ear and mouth' },
  { code: 'H10.9', name: 'Conjunctivitis, unspecified', group: 'Eye, ear and mouth', keywords: 'red eye pink eye' },
  { code: 'H00.0', name: 'Hordeolum (stye)', group: 'Eye, ear and mouth' },
  { code: 'A71.9', name: 'Trachoma, unspecified', group: 'Eye, ear and mouth' },
  { code: 'H26.9', name: 'Cataract, unspecified', group: 'Eye, ear and mouth' },
  { code: 'H40.9', name: 'Glaucoma, unspecified', group: 'Eye, ear and mouth' },
  { code: 'H52.7', name: 'Disorder of refraction, unspecified', group: 'Eye, ear and mouth', keywords: 'glasses' },
  { code: 'R04.0', name: 'Epistaxis (nosebleed)', group: 'Eye, ear and mouth' },
  { code: 'K02.9', name: 'Dental caries, unspecified', group: 'Eye, ear and mouth', keywords: 'tooth decay toothache' },
  { code: 'K04.7', name: 'Periapical abscess without sinus', group: 'Eye, ear and mouth', keywords: 'dental abscess' },
  { code: 'K05.1', name: 'Chronic gingivitis', group: 'Eye, ear and mouth', keywords: 'gum disease' },

  // Bones, joints, pain, nerves and mind
  { code: 'M54.5', name: 'Low back pain', group: 'Musculoskeletal and nervous system' },
  { code: 'M79.1', name: 'Myalgia (muscle pain)', group: 'Musculoskeletal and nervous system' },
  { code: 'M79.6', name: 'Pain in limb', group: 'Musculoskeletal and nervous system' },
  { code: 'M25.5', name: 'Pain in joint', group: 'Musculoskeletal and nervous system', keywords: 'arthralgia' },
  { code: 'M19.9', name: 'Osteoarthritis, unspecified', group: 'Musculoskeletal and nervous system' },
  { code: 'M10.9', name: 'Gout, unspecified', group: 'Musculoskeletal and nervous system' },
  { code: 'M06.9', name: 'Rheumatoid arthritis, unspecified', group: 'Musculoskeletal and nervous system' },
  { code: 'R51', name: 'Headache', group: 'Musculoskeletal and nervous system' },
  { code: 'G43.9', name: 'Migraine, unspecified', group: 'Musculoskeletal and nervous system' },
  { code: 'G40.9', name: 'Epilepsy, unspecified', group: 'Musculoskeletal and nervous system', keywords: 'seizures fits' },
  { code: 'R42', name: 'Dizziness and giddiness', group: 'Musculoskeletal and nervous system' },
  { code: 'R55', name: 'Syncope and collapse', group: 'Musculoskeletal and nervous system', keywords: 'fainting' },
  { code: 'G47.0', name: 'Insomnia', group: 'Musculoskeletal and nervous system' },
  { code: 'F32.9', name: 'Depressive episode, unspecified', group: 'Musculoskeletal and nervous system', keywords: 'depression' },
  { code: 'F41.9', name: 'Anxiety disorder, unspecified', group: 'Musculoskeletal and nervous system' },
  { code: 'F20.9', name: 'Schizophrenia, unspecified', group: 'Musculoskeletal and nervous system' },
  { code: 'F29', name: 'Unspecified nonorganic psychosis', group: 'Musculoskeletal and nervous system' },
  { code: 'F10.2', name: 'Alcohol dependence syndrome', group: 'Musculoskeletal and nervous system' },

  // Injuries and poisoning
  { code: 'T14.9', name: 'Injury, unspecified', group: 'Injury and poisoning', keywords: 'trauma' },
  { code: 'T07', name: 'Unspecified multiple injuries', group: 'Injury and poisoning', keywords: 'polytrauma rta accident' },
  { code: 'S01.9', name: 'Open wound of head, part unspecified', group: 'Injury and poisoning', keywords: 'laceration' },
  { code: 'S06.0', name: 'Concussion', group: 'Injury and poisoning', keywords: 'head injury' },
  { code: 'S61.9', name: 'Open wound of wrist and hand, part unspecified', group: 'Injury and poisoning', keywords: 'cut laceration' },
  { code: 'S52.9', name: 'Fracture of forearm, part unspecified', group: 'Injury and poisoning' },
  { code: 'S82.9', name: 'Fracture of lower leg, part unspecified', group: 'Injury and poisoning' },
  { code: 'S93.4', name: 'Sprain and strain of ankle', group: 'Injury and poisoning' },
  { code: 'T15.9', name: 'Foreign body on external eye, part unspecified', group: 'Injury and poisoning' },
  { code: 'T63.0', name: 'Toxic effect of snake venom', group: 'Injury and poisoning', keywords: 'snake bite' },
  { code: 'T65.9', name: 'Toxic effect of unspecified substance', group: 'Injury and poisoning', keywords: 'poisoning' },
  { code: 'T78.4', name: 'Allergy, unspecified', group: 'Injury and poisoning', keywords: 'allergic reaction' },

  // Cancer
  { code: 'C53.9', name: 'Malignant neoplasm of cervix uteri, unspecified', group: 'Cancer', keywords: 'cervical cancer' },
  { code: 'C50.9', name: 'Malignant neoplasm of breast, unspecified', group: 'Cancer', keywords: 'breast cancer' },
  { code: 'C61', name: 'Malignant neoplasm of prostate', group: 'Cancer', keywords: 'prostate cancer' },
  { code: 'C46.9', name: "Kaposi's sarcoma, unspecified", group: 'Cancer' },

  // Visits that are not an illness
  { code: 'R53', name: 'Malaise and fatigue', group: 'General', keywords: 'tiredness weakness' },
  { code: 'R63.0', name: 'Anorexia (loss of appetite)', group: 'General' },
  { code: 'R63.4', name: 'Abnormal weight loss', group: 'General' },
  { code: 'R07.4', name: 'Chest pain, unspecified', group: 'General' },
  { code: 'Z00.0', name: 'General medical examination', group: 'General', keywords: 'check up screening' },
  { code: 'Z09', name: 'Follow-up examination after completed treatment', group: 'General', keywords: 'review' },
  { code: 'Z76.0', name: 'Issue of repeat prescription', group: 'General', keywords: 'refill' },
  { code: 'Z02.7', name: 'Issue of medical certificate', group: 'General', keywords: 'sick note' },
];

/** The list entry for a code, if it is one of the common codes. */
export function findIcd10(code: string | null | undefined): Icd10Entry | undefined {
  if (!code) return undefined;
  const wanted = code.trim().toUpperCase();
  return ICD10_COMMON.find((entry) => entry.code === wanted);
}

/**
 * Entries matching what someone has typed - by code, by any word of the name,
 * or by a keyword - best matches first: an exact code, a code that starts with
 * the text, whole words ("urti" finds URTI before it finds Urticaria), words that
 * start with it, then anything that merely contains it. Every word typed must
 * match somewhere ("acute bronch" finds acute bronchitis).
 */
export function searchIcd10(query: string, limit = 8): Icd10Entry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);

  const scored: Array<{ entry: Icd10Entry; score: number }> = [];
  for (const entry of ICD10_COMMON) {
    const code = entry.code.toLowerCase();
    const haystack = `${entry.name} ${entry.keywords ?? ''}`.toLowerCase();
    const tokens = haystack.split(/[^a-z0-9]+/).filter(Boolean);

    if (!words.every((w) => code.includes(w) || haystack.includes(w))) continue;

    let score = 1;
    if (code === q) score = 100;
    else if (code.startsWith(q)) score = 80;
    else if (words.every((w) => tokens.includes(w))) score = 70;
    else if (words.every((w) => tokens.some((t) => t.startsWith(w)))) score = 50;
    else if (haystack.includes(q)) score = 20;
    if (entry.name.toLowerCase().startsWith(q)) score += 10;
    scored.push({ entry, score });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .slice(0, limit)
    .map((s) => s.entry);
}
