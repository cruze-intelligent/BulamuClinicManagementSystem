'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Building2, CalendarClock, FlaskConical, Pill, Stethoscope } from 'lucide-react';

type MeResponse = {
  account: { portableId: string; email: string; phone: string; createdAt: string };
  records: Array<{
    id: string;
    name: string;
    clinic: { id: string; name: string; facilityType: string };
    appointments: Array<{ id: string; date: string; time: string; status: string; notes: string | null; doctor: { name: string } }>;
    consultations: Array<{
      id: string; diagnosis: string; symptoms: string; createdAt: string;
      prescriptions: Array<{ id: string; medication: string; dosage: string; frequency: string; duration: string }>;
      invoice: { id: string; amount: number; status: string; createdAt: string } | null;
    }>;
    labTests: Array<{ id: string; testName: string; results: string; status: string; createdAt: string }>;
  }>;
};

export default function PatientPortalDashboardPage() {
  const [data, setData] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchMe = async () => {
      const token = localStorage.getItem('patientToken');
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patient-portal/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json();
        if (body.success) setData(body);
        else setError(body.error || 'Unable to load your records');
      } catch {
        setError('Unable to reach the Bulamu API');
      } finally {
        setLoading(false);
      }
    };
    fetchMe();
  }, []);

  if (loading) return <div className="p-8 text-center text-slate-500 dark:text-slate-400">Loading your records...</div>;
  if (error) return <div className="p-8 text-center text-red-600">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <Card className="rounded-lg border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Patient ID</p>
        <p className="mt-1 font-mono text-lg font-semibold text-emerald-700 dark:text-emerald-500">{data.account.portableId}</p>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{data.account.email} - {data.account.phone}</p>
      </Card>

      {data.records.length === 0 && (
        <Card className="rounded-lg border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm text-slate-500 dark:text-slate-400">No facility has linked a record to your account yet.</p>
        </Card>
      )}

      {data.records.map((record) => (
        <Card key={record.id} className="rounded-lg border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <Building2 className="size-4 text-emerald-700" aria-hidden="true" />
            <h2 className="text-base font-semibold text-slate-950 dark:text-slate-50">{record.clinic.name}</h2>
          </div>

          <div className="mt-4">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              <CalendarClock className="size-4" aria-hidden="true" />
              Appointments
            </div>
            {record.appointments.length === 0 ? (
              <p className="mt-1 text-sm text-slate-400">None yet</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {record.appointments.map((a) => (
                  <li key={a.id} className="rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800">
                    <span className="font-medium text-slate-800 dark:text-slate-200">{new Date(a.date).toLocaleDateString()} at {a.time}</span>
                    <span className="ml-2 text-slate-500 dark:text-slate-400">with Dr. {a.doctor.name} - {a.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-4">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              <Stethoscope className="size-4" aria-hidden="true" />
              Consultations
            </div>
            {record.consultations.length === 0 ? (
              <p className="mt-1 text-sm text-slate-400">None yet</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {record.consultations.map((c) => (
                  <li key={c.id} className="rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800">
                    <p className="font-medium text-slate-800 dark:text-slate-200">{c.diagnosis} - {new Date(c.createdAt).toLocaleDateString()}</p>
                    <p className="text-slate-500 dark:text-slate-400">{c.symptoms}</p>
                    {c.prescriptions.length > 0 && (
                      <div className="mt-1.5 flex items-start gap-1.5">
                        <Pill className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                        <p className="text-slate-600 dark:text-slate-300">
                          {c.prescriptions.map((p) => `${p.medication} (${p.dosage}, ${p.frequency}, ${p.duration})`).join('; ')}
                        </p>
                      </div>
                    )}
                    {c.invoice && (
                      <p className="mt-1 text-slate-500 dark:text-slate-400">
                        Invoice: UGX {c.invoice.amount.toLocaleString()} - {c.invoice.status}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-4">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              <FlaskConical className="size-4" aria-hidden="true" />
              Lab tests
            </div>
            {record.labTests.length === 0 ? (
              <p className="mt-1 text-sm text-slate-400">None yet</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {record.labTests.map((t) => (
                  <li key={t.id} className="rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800">
                    <span className="font-medium text-slate-800 dark:text-slate-200">{t.testName}</span>
                    <span className="ml-2 text-slate-500 dark:text-slate-400">{t.status}{t.results ? ` - ${t.results}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
