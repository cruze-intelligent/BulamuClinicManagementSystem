import { AlertTriangle, CheckCircle2, Clock, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { diagnosesOf, type DiagnosisView } from '@/lib/diagnosis';
import { formatPrescription, type PrescriptionView } from '@/lib/prescription';
import { abnormalVitals, vitalsText } from '@/lib/wards';
import { formatDate } from '@/lib/time';

export type ConsultationLike = {
  diagnosis?: string;
  diagnoses?: DiagnosisView[];
  symptoms?: string;
  history?: string | null;
  examination?: string | null;
  vitals?: Record<string, number> | null;
  clinicalNotes?: string | null;
  prescriptions?: Array<PrescriptionView & { id?: string }>;
  procedures?: Array<{ id?: string; name: string; notes?: string | null }>;
};

const SECTION = 'text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400';

/**
 * One consultation as a clinician expects to read it: the diagnoses (ICD-10
 * code, primary/secondary, confirmed or suspected), the presenting complaints,
 * the assessment and plan, and each prescription written out in full - the drug
 * with its strength and form, then the directions in plain words. The same view
 * is used everywhere a consultation is shown, for staff and for patients.
 */
export function ConsultationDetails({
  consultation, showNotes = true, showDispenseStatus = true, onPrintPrescription, printDisabledReason, printing,
}: {
  consultation: ConsultationLike;
  /** The clinician's assessment and plan. Not shown to patients. */
  showNotes?: boolean;
  /** Show whether each item has been dispensed. Only meaningful for records that have reached the server. */
  showDispenseStatus?: boolean;
  onPrintPrescription?: () => void;
  /** Why printing is unavailable right now (for example, not yet synced). */
  printDisabledReason?: string;
  printing?: boolean;
}) {
  const diagnoses = diagnosesOf(consultation);
  const prescriptions = consultation.prescriptions ?? [];
  const procedures = consultation.procedures ?? [];

  return (
    <div className="space-y-4">
      <div>
        <p className={SECTION}>Diagnosis</p>
        {diagnoses.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">No diagnosis recorded</p>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {diagnoses.map((d, i) => (
              <li key={d.id ?? `${d.description}-${i}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                {d.icd10Code && (
                  <span className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-800 dark:bg-slate-700 dark:text-slate-100">
                    {d.icd10Code}
                  </span>
                )}
                <span className={d.type === 'PRIMARY' ? 'font-semibold text-slate-900 dark:text-slate-50' : 'text-slate-800 dark:text-slate-200'}>
                  {d.description}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  d.type === 'PRIMARY' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                }`}>
                  {d.type === 'PRIMARY' ? 'Primary' : 'Secondary'}
                </span>
                {d.certainty === 'PROVISIONAL' && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200">Suspected</span>
                )}
                {d.notes && <span className="w-full text-xs text-slate-500 dark:text-slate-400">{d.notes}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {consultation.symptoms && (
        <div>
          <p className={SECTION}>Presenting complaints</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200">{consultation.symptoms}</p>
        </div>
      )}

      {showNotes && consultation.history && (
        <div>
          <p className={SECTION}>History</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200">{consultation.history}</p>
        </div>
      )}

      {consultation.vitals && Object.keys(consultation.vitals).length > 0 && (
        <div>
          <p className={SECTION}>Vital signs</p>
          <p className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-200">{vitalsText(consultation.vitals)}</p>
          {abnormalVitals(consultation.vitals).length > 0 && <p className="text-xs font-semibold text-rose-700 dark:text-rose-400">{abnormalVitals(consultation.vitals).join(' · ')}</p>}
        </div>
      )}

      {showNotes && consultation.examination && (
        <div>
          <p className={SECTION}>Examination</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200">{consultation.examination}</p>
        </div>
      )}

      {showNotes && consultation.clinicalNotes && (
        <div>
          <p className={SECTION}>Assessment and plan</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200">{consultation.clinicalNotes}</p>
        </div>
      )}

      {(prescriptions.length > 0 || procedures.length > 0) && (
        <div>
          <div className="flex items-center justify-between gap-2">
            <p className={SECTION}>{prescriptions.length ? 'Prescriptions' : 'Procedures'}</p>
            {onPrintPrescription && (
              <Button
                type="button" size="sm" variant="outline" onClick={onPrintPrescription}
                disabled={!!printDisabledReason || printing} title={printDisabledReason}
              >
                <Printer className="size-4" aria-hidden="true" />
                {printing ? 'Preparing...' : 'Print medical form'}
              </Button>
            )}
          </div>
          <ol className="mt-1.5 space-y-2">
            {prescriptions.map((rx, i) => {
              const line = formatPrescription(rx);
              return (
                <li key={rx.id ?? `${rx.medication}-${i}`} className="rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-800">
                  <p className="font-semibold text-slate-900 dark:text-slate-50">
                    <span className="mr-1.5 text-slate-400">{i + 1}.</span>{line.order}
                  </p>
                  {(line.details || line.quantity || line.instructions) && (
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {[line.details, line.quantity, line.instructions].filter(Boolean).join('  |  ')}
                    </p>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                    {rx.allergyOverride && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 font-medium text-rose-800 dark:bg-rose-900 dark:text-rose-200">
                        <AlertTriangle className="size-3" aria-hidden="true" />
                        Prescribed despite a recorded allergy
                      </span>
                    )}
                    {rx.dispensedAt && rx.dispensedBy && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                        <CheckCircle2 className="size-3" aria-hidden="true" />
                        Dispensed {formatDate(rx.dispensedAt)} by {rx.dispensedBy.name}
                      </span>
                    )}
                    {rx.dispensedAt && !rx.dispensedBy && rx.id && showDispenseStatus && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                        <CheckCircle2 className="size-3" aria-hidden="true" />
                        Dispensed
                      </span>
                    )}
                    {!rx.dispensedAt && rx.id && showDispenseStatus && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                        <Clock className="size-3" aria-hidden="true" />
                        Awaiting dispensing
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {procedures.length > 0 && (
            <>
              {prescriptions.length > 0 && <p className={`${SECTION} mt-3`}>Procedures</p>}
              <ol className="mt-1.5 space-y-2">
                {procedures.map((p, i) => (
                  <li key={p.id ?? `${p.name}-${i}`} className="rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-800">
                    <p className="font-semibold text-slate-900 dark:text-slate-50"><span className="mr-1.5 text-slate-400">{i + 1}.</span>{p.name}</p>
                    {p.notes && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{p.notes}</p>}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </div>
  );
}
