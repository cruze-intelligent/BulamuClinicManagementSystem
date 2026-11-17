'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import {
  listLocalConsultations,
  subscribeToLocalChanges,
  LocalConsultation,
} from '@/lib/local-first';
import { ConsultationDetails } from '@/components/consultation-details';
import { WaitingRoom } from '@/components/waiting-room';
import { openDocumentPreview } from '@/lib/document-preview';
import { formatDateTime } from '@/lib/time';

export default function ConsultationsPage() {
  const [consultations, setConsultations] = useState<LocalConsultation[]>([]);
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
    const localData = await listLocalConsultations();
    setConsultations(localData);
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