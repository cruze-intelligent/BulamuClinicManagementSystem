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
import { Input } from '@/components/ui/input';
import { patientIdText } from '@/lib/patient-id';
import { matchesPatient } from '@/lib/search';

// "0772 123 456" and "0772123456" are the same number.

export default function PatientsPage() {
  const [patients, setPatients] = useState<LocalPatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const loadData = async () => {
    const clinicId = getCurrentClinicId();
    if (!clinicId) return;

    // Load from local store first for instant UI response
    const localData = await listLocalPatients(clinicId);
    setPatients(localData);
    setLoading(false);
  };

  // The server's list when the page opens and when the connection returns - not on every
  // change here: saving it is a change, and the page used to ask again without end.
  const refreshFromServer = async () => {
    const clinicId = getCurrentClinicId();
    if (!clinicId || !navigator.onLine) return;
    try {
      await refreshPatientsFromServer(clinicId);
    } catch (err) {
      console.warn('Network fetch failed, relying on local records:', err);
    }
  };

  useEffect(() => {
    loadData();
    void refreshFromServer();
    const unsubscribe = subscribeToLocalChanges(loadData);
    const online = () => void refreshFromServer();
    window.addEventListener('online', online);
    return () => { unsubscribe(); window.removeEventListener('online', online); };
  }, []);

  // By name (any order), phone, Patient ID ("42", "00042", "ID 00042"), email or village - on
  // this device, so it works offline too (lib/search).
  const shown = query.trim() ? patients.filter((p) => matchesPatient(p, query)) : patients;

  return (
    <div className="min-h-screen p-8 bg-slate-50 dark:bg-slate-950">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-200">Patients</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Everyone registered at your facility</p>
          </div>
          <Link href="/patients/register">
            <Button>+ Register Patient</Button>
          </Link>
        </div>

        {patients.length > 0 && (
          <div className="mb-4">
            <label htmlFor="patient-filter" className="sr-only">Find a patient</label>
            <Input id="patient-filter" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find by name, phone or Patient ID" />
          </div>
        )}

        {loading ? (
          <p className="text-slate-500 dark:text-slate-400">Loading local records...</p>
        ) : patients.length === 0 ? (
          <Card className="p-8 text-center text-slate-500 dark:text-slate-400">
            No patients recorded yet. Click above to register a patient (works offline).
          </Card>
        ) : (
          <div className="space-y-3">
            {query.trim() && shown.length === 0 && (
              <Card className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">No patient matches "{query.trim()}".</Card>
            )}
            {shown.map((patient) => (
              <Card key={patient.id} className="p-4 flex flex-row flex-wrap justify-between items-center gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-800 dark:text-slate-200">{patient.name}</h3>
                    {patient.syncStatus === 'pending' && (
                      <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-medium">
                        Pending Sync
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {patientIdText(patient.patientNumber) && <span className="mr-3 font-mono">ID {patientIdText(patient.patientNumber)}</span>}
                    {patient.phone}
                  </p>
                </div>
                {patient.syncStatus === 'pending' ? (
                  <Button size="sm" variant="outline" disabled title="Available once this record has been sent - when you're back online">
                    Syncing...
                  </Button>
                ) : (
                  <Link href={`/patients/view?id=${patient.id}`}>
                    <Button size="sm" variant="outline">
                      View History
                    </Button>
                  </Link>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}