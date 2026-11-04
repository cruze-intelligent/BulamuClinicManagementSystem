'use client';

import { useEffect, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { useAuth } from '@/lib/useAuth';
import { DemoFacilityCard } from '@/components/demo-facility-card';
import { SampleDocumentsCard } from '@/components/sample-documents-card';

const API = process.env.NEXT_PUBLIC_API_URL;

/**
 * Everything for showing Bulamu to someone: sending a private demo facility,
 * how each demo is being used, and samples of every document and email for
 * checking how they look.
 */
export default function SuperAdminDemosPage() {
  const { hasRole } = useAuth();
  const isOperator = hasRole('SUPER_ADMIN');
  const [inbox, setInbox] = useState<string | null>(null);

  useEffect(() => {
    if (!isOperator) return;
    // Where the samples go - the operator inbox the server is set up with.
    fetch(`${API}/super-admin/system`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then((res) => res.json())
      .then((data) => setInbox(data.system?.mail?.operatorInbox ?? null))
      .catch(() => setInbox(null));
  }, [isOperator]);

  if (!isOperator) return null;

  return (
    <main className="mx-auto max-w-7xl space-y-6">
      <header>
        <div className="flex items-center gap-2 text-sm font-semibold uppercase text-emerald-700">
          <FlaskConical className="size-4" aria-hidden="true" />
          Platform administration
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">Demos</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
          Show Bulamu to a prospective client or a facility that wants a proper guided tour, and check how its documents and emails look -
          all with made-up records, never live data.
        </p>
      </header>

      <DemoFacilityCard />
      <SampleDocumentsCard inbox={inbox} />
    </main>
  );
}
