/**
 * Imaging: the kinds of examination (modalities) and the examinations most
 * often asked for under each - offered as suggestions only; the requester can
 * always write the examination in their own words. Kept in step with
 * apps/backend/src/lib/imaging.ts.
 */
export type Modality = 'XRAY' | 'ULTRASOUND' | 'CT' | 'MRI' | 'MAMMOGRAPHY' | 'FLUOROSCOPY' | 'OTHER';

export const MODALITIES: ReadonlyArray<{ value: Modality; label: string; examples: string[] }> = [
  {
    value: 'ULTRASOUND', label: 'Ultrasound scan',
    examples: ['Abdominal ultrasound', 'Pelvic ultrasound', 'Obstetric ultrasound', 'Abdomino-pelvic ultrasound', 'Renal (KUB) ultrasound', 'Prostate ultrasound', 'Breast ultrasound', 'Thyroid / neck ultrasound', 'Scrotal ultrasound', 'Soft tissue ultrasound', 'Doppler ultrasound', 'Echocardiogram'],
  },
  {
    value: 'XRAY', label: 'X-ray',
    examples: ['Chest X-ray (PA)', 'Chest X-ray (AP)', 'Abdominal X-ray (erect and supine)', 'Skull X-ray', 'Cervical spine X-ray', 'Lumbosacral spine X-ray', 'Pelvis X-ray', 'Hip X-ray', 'Knee X-ray', 'Ankle X-ray', 'Foot X-ray', 'Shoulder X-ray', 'Elbow X-ray', 'Wrist X-ray', 'Hand X-ray', 'Femur X-ray', 'Tibia and fibula X-ray', 'Humerus X-ray', 'Forearm X-ray', 'Dental X-ray', 'Sinus X-ray'],
  },
  {
    value: 'CT', label: 'CT scan',
    examples: ['CT head (brain)', 'CT chest', 'CT abdomen and pelvis', 'CT spine', 'CT angiogram', 'CT sinuses', 'CT KUB'],
  },
  { value: 'MRI', label: 'MRI scan', examples: ['MRI brain', 'MRI spine', 'MRI knee', 'MRI shoulder', 'MRI pelvis'] },
  { value: 'MAMMOGRAPHY', label: 'Mammography', examples: ['Screening mammogram', 'Diagnostic mammogram'] },
  { value: 'FLUOROSCOPY', label: 'Fluoroscopy', examples: ['Barium swallow', 'Barium meal', 'Barium enema', 'Hysterosalpingogram (HSG)', 'Intravenous urogram (IVU)', 'Retrograde urethrogram'] },
  { value: 'OTHER', label: 'Other imaging', examples: [] },
];

export const modalityLabel = (value: string) => MODALITIES.find((m) => m.value === value)?.label ?? value;

export type ImagingDraft = { modality: Modality; examination: string; clinicalInfo: string; urgent: boolean };
export const emptyImagingDraft = (): ImagingDraft => ({ modality: 'ULTRASOUND', examination: '', clinicalInfo: '', urgent: false });

/** What is missing before a request can be added. */
export function imagingDraftProblem(d: ImagingDraft): string | null {
  if (!d.examination.trim()) return 'Say what should be examined, for example "Abdominal ultrasound" or "Chest X-ray"';
  return null;
}
