// Laboratory tests commonly done at Ugandan health centres and hospital labs,
// so a test is always written the same way (which keeps results comparable and
// reports clean). A convenience, not a limit: any other test can be typed.
//
// Deliberately no reference ("normal") ranges: those depend on each lab's
// method and equipment, so the person entering a result writes it as their lab
// reports it. `resultHint` only suggests the usual format.

export type LabTestEntry = {
  name: string;
  group: string;
  sample: string;
  resultHint: string;
  /** Other names people search by. */
  aka?: string;
};

export const LAB_TESTS_CATALOG: LabTestEntry[] = [
  // Malaria and fevers
  { name: 'Malaria RDT', group: 'Malaria and fever', sample: 'Blood (finger prick)', resultHint: 'Positive / Negative (P. falciparum, Pan)', aka: 'mrdt rapid malaria' },
  { name: 'Malaria blood smear (B/S)', group: 'Malaria and fever', sample: 'Blood', resultHint: 'No parasites seen / parasites per microlitre, species', aka: 'bs microscopy thick thin film' },
  { name: 'Widal test', group: 'Malaria and fever', sample: 'Blood (serum)', resultHint: 'O and H titres, e.g. O 1:160, H 1:80', aka: 'typhoid' },
  { name: 'Typhoid rapid test (Salmonella Typhi IgM)', group: 'Malaria and fever', sample: 'Blood', resultHint: 'Positive / Negative', aka: 'typhidot' },
  { name: 'Brucella test', group: 'Malaria and fever', sample: 'Blood (serum)', resultHint: 'Positive / Negative or titre' },

  // Blood counts and chemistry
  { name: 'Haemoglobin (Hb)', group: 'Blood', sample: 'Blood', resultHint: 'g/dL', aka: 'hb hemoglobin anaemia' },
  { name: 'Complete blood count (CBC)', group: 'Blood', sample: 'Blood (EDTA)', resultHint: 'WBC, Hb, platelets and differential, with units', aka: 'fbc full blood count' },
  { name: 'Blood grouping and cross-match', group: 'Blood', sample: 'Blood', resultHint: 'ABO group and Rh, e.g. O Rh+', aka: 'bgxm group' },
  { name: 'Erythrocyte sedimentation rate (ESR)', group: 'Blood', sample: 'Blood', resultHint: 'mm/hr' },
  { name: 'Sickle cell test', group: 'Blood', sample: 'Blood', resultHint: 'Positive / Negative (or HbAA / HbAS / HbSS)', aka: 'sickling scd' },
  { name: 'Random blood sugar (RBS)', group: 'Blood', sample: 'Blood', resultHint: 'mmol/L', aka: 'glucose diabetes' },
  { name: 'Fasting blood sugar (FBS)', group: 'Blood', sample: 'Blood', resultHint: 'mmol/L', aka: 'glucose diabetes' },
  { name: 'HbA1c', group: 'Blood', sample: 'Blood', resultHint: '% (or mmol/mol)', aka: 'glycated diabetes' },
  { name: 'Renal function tests (urea, creatinine, electrolytes)', group: 'Blood', sample: 'Blood (serum)', resultHint: 'Each value with its unit', aka: 'rft kidney u&e' },
  { name: 'Liver function tests (LFTs)', group: 'Blood', sample: 'Blood (serum)', resultHint: 'ALT, AST, ALP, bilirubin, albumin with units', aka: 'lft' },
  { name: 'Lipid profile', group: 'Blood', sample: 'Blood (serum)', resultHint: 'Cholesterol, HDL, LDL, triglycerides with units', aka: 'cholesterol' },
  { name: 'Thyroid function tests (TFTs)', group: 'Blood', sample: 'Blood (serum)', resultHint: 'TSH, free T4, free T3 with units', aka: 'tft tsh thyroid t4 t3' },
  { name: 'Coagulation profile (PT/INR, APTT)', group: 'Blood', sample: 'Blood (citrate)', resultHint: 'PT (s), INR, APTT (s)', aka: 'clotting pt inr aptt warfarin' },
  { name: 'Serum uric acid', group: 'Blood', sample: 'Blood (serum)', resultHint: 'mmol/L', aka: 'urate gout' },
  { name: 'C-reactive protein (CRP)', group: 'Blood', sample: 'Blood (serum)', resultHint: 'mg/L', aka: 'crp inflammation' },
  { name: 'Prostate specific antigen (PSA)', group: 'Blood', sample: 'Blood (serum)', resultHint: 'ng/mL', aka: 'psa prostate' },
  { name: 'Serum calcium', group: 'Blood', sample: 'Blood (serum)', resultHint: 'mmol/L', aka: 'calcium ca' },

  // Hormones (fertility, menstrual and endocrine)
  { name: 'Estradiol (E2)', group: 'Hormones', sample: 'Blood (serum)', resultHint: 'pmol/L, with the day of the cycle', aka: 'estrogen oestrogen oestradiol e2 hormone fertility' },
  { name: 'Progesterone', group: 'Hormones', sample: 'Blood (serum)', resultHint: 'nmol/L, with the day of the cycle', aka: 'day 21 ovulation hormone fertility' },
  { name: 'Prolactin', group: 'Hormones', sample: 'Blood (serum)', resultHint: 'ng/mL', aka: 'prl galactorrhoea hormone fertility' },
  { name: 'Follicle stimulating hormone (FSH)', group: 'Hormones', sample: 'Blood (serum)', resultHint: 'IU/L, with the day of the cycle', aka: 'fsh hormone fertility menopause' },
  { name: 'Luteinising hormone (LH)', group: 'Hormones', sample: 'Blood (serum)', resultHint: 'IU/L, with the day of the cycle', aka: 'lh luteinizing hormone fertility ovulation' },
  { name: 'Anti-Mullerian hormone (AMH)', group: 'Hormones', sample: 'Blood (serum)', resultHint: 'ng/mL', aka: 'amh ovarian reserve hormone fertility' },
  { name: 'Testosterone (total)', group: 'Hormones', sample: 'Blood (serum)', resultHint: 'nmol/L', aka: 'testosterone androgen hormone' },

  // Cardiac markers
  { name: 'Troponin I', group: 'Cardiac markers', sample: 'Blood (serum or plasma)', resultHint: 'ng/mL against the assay cut-off, or Positive / Negative for a rapid test', aka: 'troponin trop ctni heart attack myocardial infarction cardiac' },
  { name: 'Creatine kinase-MB (CK-MB)', group: 'Cardiac markers', sample: 'Blood (serum)', resultHint: 'U/L or ng/mL, by the assay', aka: 'ckmb ck mb heart cardiac' },
  { name: 'Creatine kinase (CK, total)', group: 'Cardiac markers', sample: 'Blood (serum)', resultHint: 'U/L', aka: 'cpk ck muscle cardiac' },
  { name: 'NT-proBNP', group: 'Cardiac markers', sample: 'Blood (serum or plasma)', resultHint: 'pg/mL', aka: 'bnp heart failure cardiac' },
  { name: 'D-dimer', group: 'Cardiac markers', sample: 'Blood (citrate)', resultHint: 'mg/L FEU', aka: 'ddimer dvt clot embolism' },

  // Tumour markers
  { name: 'CA 19-9', group: 'Tumour markers', sample: 'Blood (serum)', resultHint: 'U/mL', aka: 'ca19-9 ca199 pancreas tumour marker cancer' },
  { name: 'Beta hCG (quantitative)', group: 'Tumour markers', sample: 'Blood (serum)', resultHint: 'mIU/mL', aka: 'bhcg b-hcg serum pregnancy tumour marker' },
  { name: 'CA 125', group: 'Tumour markers', sample: 'Blood (serum)', resultHint: 'U/mL', aka: 'ca125 ovary ovarian tumour marker cancer' },
  { name: 'Carcinoembryonic antigen (CEA)', group: 'Tumour markers', sample: 'Blood (serum)', resultHint: 'ng/mL', aka: 'cea colon bowel tumour marker cancer' },
  { name: 'Alpha-fetoprotein (AFP)', group: 'Tumour markers', sample: 'Blood (serum)', resultHint: 'ng/mL', aka: 'afp liver hepatoma tumour marker cancer' },

  // HIV, TB and other infections
  { name: 'HIV rapid test', group: 'HIV, TB and infections', sample: 'Blood', resultHint: 'Reactive / Non-reactive (per national algorithm)', aka: 'hct determine statpak' },
  { name: 'CD4 count', group: 'HIV, TB and infections', sample: 'Blood', resultHint: 'cells/mm3' },
  { name: 'HIV viral load', group: 'HIV, TB and infections', sample: 'Blood', resultHint: 'copies/mL', aka: 'vl' },
  { name: 'TB GeneXpert (MTB/RIF)', group: 'HIV, TB and infections', sample: 'Sputum', resultHint: 'MTB detected / not detected; RIF resistance', aka: 'xpert tb' },
  { name: 'Sputum smear (ZN)', group: 'HIV, TB and infections', sample: 'Sputum', resultHint: 'AFB seen / not seen, grade', aka: 'afb tb microscopy' },
  { name: 'TB LAM', group: 'HIV, TB and infections', sample: 'Urine', resultHint: 'Positive / Negative', aka: 'lf-lam' },
  { name: 'Syphilis test (RPR/VDRL)', group: 'HIV, TB and infections', sample: 'Blood', resultHint: 'Reactive / Non-reactive', aka: 'tpha' },
  { name: 'Hepatitis B surface antigen (HBsAg)', group: 'HIV, TB and infections', sample: 'Blood', resultHint: 'Positive / Negative', aka: 'hep b' },
  { name: 'Hepatitis C antibody', group: 'HIV, TB and infections', sample: 'Blood', resultHint: 'Positive / Negative', aka: 'hcv hep c' },
  { name: 'H. pylori test', group: 'HIV, TB and infections', sample: 'Stool or blood', resultHint: 'Positive / Negative', aka: 'helicobacter ulcer' },
  { name: 'Cryptococcal antigen (CrAg)', group: 'HIV, TB and infections', sample: 'Blood or CSF', resultHint: 'Positive / Negative' },

  // Urine and stool
  { name: 'Urinalysis', group: 'Urine and stool', sample: 'Urine', resultHint: 'Dipstick values and microscopy findings', aka: 'urine re ua' },
  { name: 'Urine pregnancy test', group: 'Urine and stool', sample: 'Urine', resultHint: 'Positive / Negative', aka: 'hcg upt pregnancy' },
  { name: 'Stool analysis', group: 'Urine and stool', sample: 'Stool', resultHint: 'Macroscopy and microscopy findings (ova, cysts)', aka: 'stool re' },
  { name: 'Urine culture and sensitivity', group: 'Urine and stool', sample: 'Urine', resultHint: 'Organism and the antibiotics it is sensitive / resistant to', aka: 'c&s' },
  { name: 'Blood culture and sensitivity', group: 'Urine and stool', sample: 'Blood', resultHint: 'Organism and sensitivities, or no growth', aka: 'c&s' },
];

export const LAB_TEST_GROUPS = [...new Set(LAB_TESTS_CATALOG.map((t) => t.group))];

export function findLabTest(name: string): LabTestEntry | undefined {
  const wanted = name.trim().toLowerCase();
  return LAB_TESTS_CATALOG.find((t) => t.name.toLowerCase() === wanted);
}
