'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Building2,
  MonitorSmartphone,
  ShieldCheck,
  Stethoscope,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ContactIcons } from '@/components/contact-icons';
import { CompanyName } from '@/components/company-credit';
import { getHomePath } from '@/lib/useAuth';
import { liveSessionUser } from '@/lib/staff-session';
import { PlanCards, ROLE_CARDS, ServiceCards } from '@/components/offering-cards';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // Straight back in for someone still signed in, to their own start page.
    const user = liveSessionUser();
    if (user) router.replace(getHomePath(user));
  }, [router]);

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Bulamu Medical Facility OS',
    applicationCategory: 'MedicalApplication',
    operatingSystem: 'Web, Android, iOS (PWA)',
    description:
      'Offline-first clinic management system for Ugandan medical facilities: patient records, appointments, prescriptions, billing, inventory, and HMIS 105 / FHIR reporting.',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'UGX',
      description: '2-week free trial, then a monthly subscription',
    },
    provider: {
      '@type': 'Organization',
      name: 'Cruze Intelligent Systems (U) Ltd',
      areaServed: 'UG',
    },
  };

  return (
    <main className="min-h-screen bg-white text-slate-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <section className="relative overflow-hidden bg-slate-950 text-white">
        <img
          src="https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=1600&q=80"
          alt="Medical team working with digital records"
          className="absolute inset-0 h-full w-full object-cover opacity-30"
        />
        <div className="relative mx-auto max-w-7xl px-6 py-8">
          <nav className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-md bg-emerald-500 text-slate-950">
                <ShieldCheck className="size-5" aria-hidden="true" />
              </div>
              <div>
                <span className="block text-lg font-semibold">Bulamu</span>
                <span className="block text-xs text-slate-300">By <CompanyName /></span>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/auth/register" className="text-sm font-medium text-slate-300 hover:text-white">
                Register your facility
              </Link>
              <Link href="/auth/login">
                <Button variant="secondary">Sign in</Button>
              </Link>
            </div>
          </nav>

          <div className="max-w-3xl py-24">
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-300">Medical Facility OS for Uganda</p>
            <h1 className="mt-4 text-5xl font-semibold tracking-tight md:text-6xl">
              One operating layer for facilities that must keep working.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-200">
              Bulamu supports clinics, health centres, hospitals, laboratories, imaging centres, pharmacies, outreach teams, and mobile
              units with offline-first operations, national reporting, and centralized administrative governance.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/auth/register">
                <Button size="lg">
                  Start free trial
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Button>
              </Link>
              <Link href="/auth/login">
                <Button size="lg" variant="outline" className="border-white/30 bg-white/10 text-white hover:bg-white/20">
                  Sign in
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-4 px-6 py-12 md:grid-cols-3">
        {[
          { title: 'Facility authorization', body: 'Administrators authorize and supervise the full network.', icon: Building2 },
          { title: 'Clinical workflow', body: 'Patient registration through consultation, lab, medicine, and billing.', icon: Stethoscope },
          { title: 'PWA resilience', body: 'Installable app shell, offline records, mutation queue, and sync status.', icon: MonitorSmartphone },
        ].map((item) => (
          <Card key={item.title} className="rounded-lg p-5">
            <item.icon className="size-5 text-emerald-700" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold">{item.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{item.body}</p>
          </Card>
        ))}
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-16" aria-labelledby="services">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Services</p>
        <h2 id="services" className="mt-1 text-3xl font-semibold tracking-tight">Everything a facility runs on, in one system</h2>
        <p className="mt-2 max-w-2xl text-slate-600">Every service is included in every plan. Each member of staff sees only what their role needs.</p>
        <div className="mt-8"><ServiceCards /></div>
      </section>

      <section className="bg-slate-50 py-16" aria-labelledby="roles">
        <div className="mx-auto max-w-7xl px-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Roles</p>
          <h2 id="roles" className="mt-1 text-3xl font-semibold tracking-tight">Built for every role in your facility</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ROLE_CARDS.map((item) => (
              <div key={item.title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <item.icon className="size-5 text-emerald-700" aria-hidden="true" />
                <h3 className="mt-3 font-semibold">{item.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-slate-600">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-16" aria-labelledby="plans">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Plans</p>
        <h2 id="plans" className="mt-1 text-3xl font-semibold tracking-tight">Start free, then one simple monthly price</h2>
        <p className="mt-2 max-w-2xl text-slate-600">Try everything for 14 days. Paying early never costs you trial days - your paid month starts when the trial ends.</p>
        <div className="mt-10"><PlanCards /></div>
      </section>
      <footer className="border-t border-slate-200 px-6 py-6">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 text-center text-sm text-slate-500 md:flex-row md:text-left">
          <p>Bulamu is a product of <CompanyName className="hover:text-emerald-700 hover:underline" />.</p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link href="/legal/terms" className="hover:text-emerald-700 hover:underline">Terms of Service</Link>
            <Link href="/legal/privacy" className="hover:text-emerald-700 hover:underline">Privacy Policy</Link>
            <Link href="/legal/data-retention" className="hover:text-emerald-700 hover:underline">Data Retention</Link>
            <Link href="/legal/refund-policy" className="hover:text-emerald-700 hover:underline">Refund Policy</Link>
            <ContactIcons />
          </div>
        </div>
      </footer>
    </main>
  );
}
