'use client';

import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { ContactIcons } from '@/components/contact-icons';
import { useAuth, getHomePath } from '@/lib/useAuth';

const LEGAL_LINKS = [
  { href: '/legal/terms', label: 'Terms of Service' },
  { href: '/legal/privacy', label: 'Privacy Policy' },
  { href: '/legal/data-retention', label: 'Data Retention' },
  { href: '/legal/refund-policy', label: 'Refund Policy' },
];

export function LegalLayout({ title, effectiveDate, children }: { title: string; effectiveDate: string; children: React.ReactNode }) {
  const { user } = useAuth();
  return (
    <main className="min-h-screen bg-white text-slate-950">
      <header className="border-b border-slate-200 bg-slate-950 px-6 py-6 text-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <Link href={getHomePath(user)} className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-emerald-500 text-slate-950">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </div>
            <span className="text-lg font-semibold">Bulamu</span>
          </Link>
          <nav className="hidden gap-5 text-sm text-slate-300 sm:flex">
            {LEGAL_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-white hover:underline">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <article className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">Effective {effectiveDate} - Cruze Intelligent Systems (U) Ltd, Kampala, Uganda</p>
        <div className="prose prose-slate mt-8 max-w-none space-y-6 text-sm leading-7 text-slate-700 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-slate-950 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6">
          {children}
        </div>
      </article>

      <footer className="border-t border-slate-200 px-6 py-6">
        <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-4 text-center text-sm text-slate-500 sm:flex-row sm:text-left">
          <p>Bulamu is a product of Cruze Intelligent Systems (U) Ltd.</p>
          <ContactIcons />
        </div>
      </footer>
    </main>
  );
}
