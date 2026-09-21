'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  MonitorSmartphone,
  Package,
  ShieldCheck,
  Stethoscope,
  UserCog,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ContactIcons } from '@/components/contact-icons';
import { CompanyName } from '@/components/company-credit';

const roles = [
  { title: 'Administrator', body: 'Approve staff, track billing and trial status, and run HMIS 105 / FHIR reports for the whole facility.', icon: UserCog },
  { title: 'Doctor', body: "Record diagnoses, prescriptions, and lab requests directly against each patient's history.", icon: Stethoscope },
  { title: 'Nurse', body: "Coordinate the day's schedule, register patients, and capture household outreach visits offline.", icon: CalendarClock },
  { title: 'Pharmacist', body: 'Track medicine stock, reorder levels, and fulfil prescriptions from consultations.', icon: Package },
  { title: 'Front desk', body: 'Register patients, manage appointment scheduling, and coordinate day-to-day front-office operations.', icon: ClipboardList },
  { title: 'Patient', body: 'View personal health records and visit history, and stay recognized across every participating facility with a secure patient account.', icon: UserRound },
];

const capabilities = [
  'Patient registry and searchable history',
  'Appointments, consultations, prescriptions, and lab requests',
  'Billing, invoices, medicine stock, and reorder alerts',
  'HMIS 105 reporting and FHIR R4 export',
  'Installable PWA with offline queue and sync status',
  'Facility authorization and administrative governance',
];

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const user = localStorage.getItem('user');
    if (user) router.push('/dashboard');
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

      <section className="mx-auto max-w-7xl px-6 pb-12">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="text-2xl font-semibold tracking-tight">Built for every role in your facility</h2>
          <p className="mt-1 text-sm text-slate-500">Each account only sees what its role needs - one system, the right view for everyone.</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {roles.map((item) => (
              <div key={item.title} className="rounded-lg border border-slate-200 bg-white p-4">
                <item.icon className="size-5 text-emerald-700" aria-hidden="true" />
                <h3 className="mt-3 text-sm font-semibold">{item.title}</h3>
                <p className="mt-1.5 text-xs leading-5 text-slate-600">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-16">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h2 className="text-2xl font-semibold tracking-tight">Operational capabilities</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {capabilities.map((item) => (
              <div key={item} className="flex items-center gap-2 text-sm text-slate-700">
                <CheckCircle2 className="size-4 text-emerald-700" aria-hidden="true" />
                {item}
              </div>
            ))}
          </div>
        </div>
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
