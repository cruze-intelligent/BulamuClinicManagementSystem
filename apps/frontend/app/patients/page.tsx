'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import {
  listLocalPatients,
  refreshPatientsFromServer,
  getCurrentClinicId,
  subscribeToLocalChanges,
  LocalPatient,
} from '@/lib/local-first';

export default function PatientsPage() {
  const [patients, setPatients] = useState<LocalPatient[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    const clinicId = getCurrentClinicId();
    if (!clinicId) return;

    // Load from local store first for instant UI response
    const localData = await listLocalPatients(clinicId);
    setPatients(localData);
    setLoading(false);

    // Refresh from server in background if online
    if (navigator.onLine) {
      try {
        const remoteData = await refreshPatientsFromServer(clinicId);
        setPatients(remoteData);
      } catch (err) {
        console.warn('Network fetch failed, relying on local records:', err);
      }
    }
  };

  useEffect(() => {
    loadData();
    const unsubscribe = subscribeToLocalChanges(loadData);
    return () => unsubscribe();
  }, []);

  return (
    <div className="min-h-screen p-8 bg-slate-50">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-800">Patients</h1>
            <p className="text-sm text-slate-500 mt-1">Local-First Clinical Registry</p>
          </div>
          <Link href="/patients/register">
            <Button>+ Register Patient</Button>
          </Link>
        </div>

        {loading ? (
          <p className="text-slate-500">Loading local records...</p>
        ) : patients.length === 0 ? (
          <Card className="p-8 text-center text-slate-500">
            No patients recorded yet. Click above to register a patient (works offline).
          </Card>
        ) : (
          <div className="space-y-3">
            {patients.map((patient) => (
              <Card key={patient.id} className="p-4 flex justify-between items-center">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-800">{patient.name}</h3>
                    {patient.syncStatus === 'pending' && (
                      <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-medium">
                        Pending Sync
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-500">{patient.phone}</p>
                </div>
                <Link href={`/patients/${patient.id}`}>
                  <Button size="sm" variant="outline">
                    View History
                  </Button>
                </Link>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}