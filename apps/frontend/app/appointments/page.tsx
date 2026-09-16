'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import {
  listLocalAppointments,
  cacheAppointments,
  getCurrentClinicId,
  subscribeToLocalChanges,
  LocalAppointment,
} from '@/lib/local-first';

export default function AppointmentsPage() {
  const [appointments, setAppointments] = useState<LocalAppointment[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAppointments = async () => {
    const clinicId = getCurrentClinicId();
    if (!clinicId) return;

    const localData = await listLocalAppointments(clinicId);
    setAppointments(localData);
    setLoading(false);

    if (navigator.onLine) {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/appointments/${clinicId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.success && Array.isArray(data.appointments)) {
          await cacheAppointments(data.appointments);
          const updated = await listLocalAppointments(clinicId);
          setAppointments(updated);
        }
      } catch (err) {
        console.warn('Appointments fetch failed, using local records:', err);
      }
    }
  };

  useEffect(() => {
    loadAppointments();
    const unsubscribe = subscribeToLocalChanges(loadAppointments);
    return () => unsubscribe();
  }, []);

  return (
    <div className="min-h-screen p-8 bg-slate-50 dark:bg-slate-950">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-200">Appointments</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Local-First Triage & Visit Queue</p>
          </div>
          <Link href="/appointments/book">
            <Button>+ Book Appointment</Button>
          </Link>
        </div>

        {loading ? (
          <p className="text-slate-500 dark:text-slate-400">Loading appointments...</p>
        ) : appointments.length === 0 ? (
          <Card className="p-8 text-center text-slate-500 dark:text-slate-400">
            No appointments found. Click above to book an appointment (works offline).
          </Card>
        ) : (
          <div className="space-y-3">
            {appointments.map((apt) => (
              <Card key={apt.id} className="p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-slate-800 dark:text-slate-200">{apt.patient?.name || 'Patient'}</h3>
                      {apt.syncStatus === 'pending' && (
                        <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-medium">
                          Pending Sync
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {new Date(apt.date).toLocaleDateString()} at {apt.time}
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">Dr. {apt.doctor?.name || 'Assigned Clinician'}</p>
                    {apt.notes && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{apt.notes}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    {apt.status === 'SCHEDULED' && (
                      <Link href={`/consultations/record?appointmentId=${apt.id}&patientId=${apt.patientId}`}>
                        <Button size="sm">Record Consultation</Button>
                      </Link>
                    )}
                    <span
                      className={`text-xs px-2.5 py-1 rounded font-medium ${
                        apt.status === 'COMPLETED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : apt.status === 'CANCELLED'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {apt.status}
                    </span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}