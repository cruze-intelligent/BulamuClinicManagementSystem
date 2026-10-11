'use client';

import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { InstallGuide } from '@/components/install-guide';

// Public, so staff can install Bulamu before their account exists - the same
// guide is on the Help page once signed in.
export default function InstallPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 dark:bg-slate-950">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-md bg-emerald-700 text-white">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </div>
            <span className="text-lg font-semibold text-slate-950 dark:text-slate-50">Bulamu</span>
          </Link>
          <Link href="/auth/login" className="flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to sign in
          </Link>
        </header>
        <InstallGuide />
      </div>
    </main>
  );
}
