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

export default function ConsultationsPage() {
  const [consultations, setConsultations] = useState<LocalConsultation[]>([]);
  const [loading, setLoading] = useState(true);

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
    <div className="min-h-screen p-8 bg-slate-50 dark:bg-slate-950">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-200">Consultation History</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Local-First Clinical Records</p>
          </div>
          <Link href="/consultations/record">
            <Button>+ Record Encounter</Button>
          </Link>
        </div>

        {loading ? (
          <p className="text-slate-500 dark:text-slate-400">Loading consultations...</p>
        ) : consultations.length === 0 ? (
          <Card className="p-8 text-center text-slate-500 dark:text-slate-400">
            No consultations recorded yet. Click above to record a clinical encounter (works offline).
          </Card>
        ) : (
          <div className="space-y-4">
            {consultations.map((consult) => (
              <Card key={consult.id} className="p-6">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-lg text-slate-800 dark:text-slate-200">
                        {consult.patient?.name || 'Patient'} — {consult.diagnosis}
                      </h3>
                      {consult.syncStatus === 'pending' && (
                        <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-medium">
                          Pending Sync
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {new Date(consult.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="mb-4">
                  <p className="text-sm text-slate-700 dark:text-slate-300">
                    <strong className="font-semibold">Symptoms / Complaints:</strong> {consult.symptoms}
                  </p>
                </div>

                {consult.prescriptions && consult.prescriptions.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-sm text-slate-800 dark:text-slate-200 mb-2">Prescriptions & Dosage:</h4>
                    <div className="space-y-1.5">
                      {consult.prescriptions.map((rx, idx) => (
                        <div key={idx} className="bg-slate-100 dark:bg-slate-800 p-2.5 rounded-md text-sm text-slate-800 dark:text-slate-200">
                          <span className="font-medium text-blue-900">{rx.medication}</span>
                          <span className="text-slate-500 dark:text-slate-400 ml-2">
                            {rx.dosage} • {rx.frequency} • {rx.duration}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}