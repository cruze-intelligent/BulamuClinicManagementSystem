'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import {
  listLocalConsultations,
  listLocalLabTests,
  subscribeToLocalChanges,
  LocalConsultation,
  LocalLabTest,
} from '@/lib/local-first';
import { FlaskConical } from 'lucide-react';
import { ConsultationDetails } from '@/components/consultation-details';
import { WaitingRoom } from '@/components/waiting-room';
import { openDocumentPreview } from '@/lib/document-preview';
import { formatDateTime } from '@/lib/time';

export default function ConsultationsPage() {
  const [consultations, setConsultations] = useState<LocalConsultation[]>([]);
  const [labTests, setLabTests] = useState<LocalLabTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [printingId, setPrintingId] = useState<string | null>(null);

  const printPrescription = async (consultationId: string) => {
    setPrintingId(consultationId);
    try {
      await openDocumentPreview(
        `${process.env.NEXT_PUBLIC_API_URL}/consultations/${consultationId}/prescription/pdf`,
        localStorage.getItem('token')
      );
    } catch (error: any) {
      alert(error.message);
    } finally {
      setPrintingId(null);
    }
  };

  const loadConsultations = async () => {
    const [localData, tests] = await Promise.all([listLocalConsultations(), listLocalLabTests()]);
    setConsultations(localData);
    setLabTests(tests);
    setLoading(false);
  };

  useEffect(() => {
    loadConsultations();
    const unsubscribe = subscribeToLocalChanges(loadConsultations);
    return () => unsubscribe();
  }, []);

  return (
    <div className="min-h-screen p-4 sm:p-8 bg-slate-50 dark:bg-slate-950">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-200">Consultations</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">The waiting room, and the visits recorded at your facility</p>
          </div>
          <Link href="/consultations/record">
            <Button>+ Record visit</Button>
          </Link>
        </div>

        <WaitingRoom />

        <WaitingForResults visits={consultations.filter((c) => c.awaitingResults)} labTests={labTests} />

        <h2 className="mb-3 text-lg font-semibold text-slate-800 dark:text-slate-200">Visits recorded</h2>
        {loading ? (
          <p className="text-slate-500 dark:text-slate-400">Loading consultations...</p>
        ) : consultations.length === 0 ? (
          <Card className="p-8 text-center text-slate-500 dark:text-slate-400">
            No visits recorded yet. Use Record visit above - it works without internet too.
          </Card>
        ) : (
          <div className="space-y-4">
            {consultations.map((consult) => (
              <Card key={consult.id} className="p-6">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-lg text-slate-800 dark:text-slate-200">
                        {consult.patient?.name || 'Patient'}
                      </h3>
                      {consult.awaitingResults && (
                        <span className="text-xs bg-sky-100 text-sky-800 px-2 py-0.5 rounded-full font-medium">Waiting for results</span>
                      )}
                      {consult.syncStatus === 'pending' && (
                        <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-medium">
                          Pending Sync
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {formatDateTime(consult.createdAt)}
                    </p>
                  </div>
                </div>

                <ConsultationDetails
                  consultation={consult}
                  onPrintPrescription={() => printPrescription(consult.id)}
                  printing={printingId === consult.id}
                  printDisabledReason={consult.syncStatus === 'pending' ? 'Available once this record has synced' : undefined}
                />
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
/**
 * Visits saved with tests sent and the diagnosis and prescription still to come:
 * the clinician comes back to each when its results are in.
 */
function WaitingForResults({ visits, labTests }: { visits: LocalConsultation[]; labTests: LocalLabTest[] }) {
  if (visits.length === 0) return null;
  return (
    <section aria-labelledby="waiting-results-title" className="mb-8">
      <h2 id="waiting-results-title" className="mb-1 text-lg font-semibold text-slate-800 dark:text-slate-200">Waiting for results</h2>
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">Visits sent for tests. Open one to read the results and finish the diagnosis and prescription.</p>
      <ul className="space-y-2">
        {visits.map((visit) => {
          const tests = labTests.filter((t) => t.consultationId === visit.id && t.status !== 'CANCELLED');
          const back = tests.filter((t) => t.status === 'COMPLETED').length;
          return (
            <li key={visit.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-800 dark:text-slate-200">{visit.patient?.name || 'Patient'}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Sent {formatDateTime(visit.createdAt)}{visit.symptoms ? ` - ${visit.symptoms.slice(0, 80)}` : ''}</p>
                  {tests.length > 0 && (
                    <p className={`mt-1 flex items-center gap-1.5 text-sm font-medium ${back === tests.length ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                      <FlaskConical className="size-4" aria-hidden="true" />
                      {back === tests.length ? 'All lab results are in' : `${back} of ${tests.length} lab results in`}
                    </p>
                  )}
                </div>
                <Link href={`/consultations/record?consultationId=${visit.id}&patientId=${visit.patientId}`}>
                  <Button size="sm">Continue the visit</Button>
                </Link>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
