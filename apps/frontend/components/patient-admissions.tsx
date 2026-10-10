'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';

/** The patient's hospital stays at this facility, current one first. */
export function PatientAdmissions({ patientId }: { patientId: string }) {
  const [admissions, setAdmissions] = useState<any[] | null>(null);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/patients/${patientId}/admissions`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then((r) => r.json())
      .then((d) => setAdmissions(d.success ? d.admissions : []))
      .catch(() => setAdmissions([]));
  }, [patientId]);

  if (!admissions || admissions.length === 0) return null;
  const date = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <Card className="mb-6 p-6">
      <h2 className="mb-3 text-xl font-bold">Hospital stays</h2>
      <ul className="divide-y divide-slate-200 dark:divide-slate-800">
        {admissions.map((a) => (
          <li key={a.id}>
            <Link href={`/wards/admission?id=${a.id}`} className="block py-2 hover:bg-slate-50 dark:hover:bg-slate-900">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{a.ward.name}{a.bed ? `, bed ${a.bed}` : ''}</span>
                <span className={`rounded px-1.5 text-xs font-medium ${a.status === 'ADMITTED' ? 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-300' : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>
                  {a.status === 'ADMITTED' ? `Admitted - day ${a.daysAdmitted}` : a.outcomeLabel}
                </span>
              </span>
              <span className="block text-sm text-slate-600 dark:text-slate-400">
                {date(a.admittedAt)}{a.dischargedAt ? ` - ${date(a.dischargedAt)}` : ''} · {a.dischargeDiagnosis || a.reason}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
