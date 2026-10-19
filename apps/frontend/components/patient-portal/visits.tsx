'use client';

import { useState } from 'react';
import { FlaskConical, Stethoscope } from 'lucide-react';
import { ConsultationDetails } from '@/components/consultation-details';
import { openDocumentPreview } from '@/lib/document-preview';
import { billState, gather, labState, portalDate, type PortalRecord } from '@/lib/patient-portal';
import { ugx } from '@/lib/finance';
import { EmptyState, FacilityTag, PortalCard, StateBadge, TabIntro } from './ui';

/** Each visit: what was found, the medicines prescribed (printable), and its bill at a glance. */
export function PortalVisits({ records, onError, onShowBills }: { records: PortalRecord[]; onError: (message: string) => void; onShowBills: () => void }) {
  const [printing, setPrinting] = useState<string | null>(null);
  const visits = gather(records, (r) => r.consultations, (c) => c.createdAt);
  const bills = new Map(records.flatMap((r) => (r.invoices ?? []).filter((b) => b.consultationId).map((b) => [b.consultationId!, b] as const)));
  const several = records.length > 1;

  const printPrescription = async (consultationId: string) => {
    setPrinting(consultationId);
    try {
      await openDocumentPreview(`${process.env.NEXT_PUBLIC_API_URL}/patient-portal/consultations/${consultationId}/prescription/pdf`, localStorage.getItem('patientToken'));
    } catch (err: any) {
      onError(err?.message || "The prescription couldn't be opened just now. Please try again.");
    } finally {
      setPrinting(null);
    }
  };

  return (
    <section>
      <TabIntro title="Your visits">What the clinician found at each visit and the medicines you were given. You can print a prescription to take to any pharmacy.</TabIntro>
      {visits.length === 0 ? (
        <EmptyState icon={Stethoscope} title="No visits recorded yet">After you see a clinician, the visit appears here: what they found and any medicines prescribed.</EmptyState>
      ) : (
        <ol className="space-y-3">
          {visits.map((visit) => {
            const bill = bills.get(visit.id);
            const state = bill ? billState(bill) : null;
            return (
              <li key={visit.id}>
                <PortalCard>
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="font-semibold text-slate-950 dark:text-slate-50">
                      Visit on {portalDate(visit.createdAt)} <FacilityTag name={visit.facility} show={several} />
                    </p>
                    {bill && state && (
                      <button type="button" onClick={onShowBills} className="flex items-center gap-2 text-sm text-slate-600 hover:underline dark:text-slate-300">
                        Bill {ugx(bill.amount)} <StateBadge tone={state.tone}>{state.label}</StateBadge>
                      </button>
                    )}
                  </div>
                  <ConsultationDetails
                    consultation={visit}
                    showNotes={false}
                    onPrintPrescription={() => printPrescription(visit.id)}
                    printing={printing === visit.id}
                  />
                </PortalCard>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** Lab tests and, once a clinician has checked them, their results. */
export function PortalResults({ records }: { records: PortalRecord[] }) {
  const tests = gather(records, (r) => r.labTests, (t) => t.createdAt);
  const several = records.length > 1;
  return (
    <section>
      <TabIntro title="Lab results">A result shows here once a clinician has checked it. If something worries you, ask your facility what it means for you.</TabIntro>
      {tests.length === 0 ? (
        <EmptyState icon={FlaskConical} title="No lab tests yet">When a clinician asks for a test, you can follow it here until the result is ready.</EmptyState>
      ) : (
        <ul className="space-y-2.5">
          {tests.map((test) => {
            const state = labState(test);
            return (
              <li key={test.id}>
                <PortalCard className={state.tone === 'muted' ? 'opacity-70' : ''}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-950 dark:text-slate-50">{test.testName}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Asked for on {portalDate(test.createdAt)} <FacilityTag name={test.facility} show={several} />
                      </p>
                    </div>
                    <StateBadge tone={state.tone}>{state.label}</StateBadge>
                  </div>
                  {state.tone === 'good' && (
                    <div className="mt-3 rounded-lg bg-emerald-50/60 px-3 py-2.5 dark:bg-emerald-950/30">
                      <p className="whitespace-pre-line text-sm text-slate-900 dark:text-slate-100">{test.results}</p>
                      {test.verifiedAt && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Checked by a clinician on {portalDate(test.verifiedAt)}</p>}
                    </div>
                  )}
                </PortalCard>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
