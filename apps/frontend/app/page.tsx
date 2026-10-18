'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, ClipboardList, Pill, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ContactIcons } from '@/components/contact-icons';
import { CompanyName } from '@/components/company-credit';
import { getHomePath } from '@/lib/useAuth';
import { liveSessionUser } from '@/lib/staff-session';
import { PlanCards, ROLE_CARDS, ServiceCards } from '@/components/offering-cards';
import { BrandLockup } from '@/components/brand';

const VALUES = [
  { icon: ClipboardList, title: "Every patient's record in one place", body: 'Visits, diagnoses, prescriptions, lab results and hospital stays, from registration onwards - for every member of staff who needs them.' },
  { icon: Pill, title: 'From the front desk to the pharmacy', body: "The doctor's prescription reaches the pharmacist and the lab result reaches the doctor, without paper going missing on the way." },
  { icon: WifiOff, title: 'Keeps working without internet', body: 'Work is saved on the device and sent as soon as the connection comes back. Installs like an app on phones and computers.' },
];

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
    name: 'Bulamu',
    applicationCategory: 'MedicalApplication',
    operatingSystem: 'Web, Android, iOS',
    description:
      'Clinic management for Ugandan health facilities: patient records, appointments, prescriptions, lab results, stock, billing and HMIS 105 reporting - even without internet.',
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
      <section className="relative overflow-hidden bg-[#04211d] text-white">
        <img
          src="https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=1600&q=80"
          alt="Medical team working with digital records"
          className="absolute inset-0 h-full w-full object-cover opacity-25"
        />
        <div className="relative mx-auto max-w-7xl px-6 py-8">
          <nav className="flex items-center justify-between">
            <Link href="/" aria-label="Bulamu home"><BrandLockup tone="dark" /></Link>
            <div className="flex items-center gap-4">
              <Link href="/auth/register" className="hidden text-sm font-medium text-slate-300 hover:text-white sm:inline">
                Register your facility
              </Link>
              <Link href="/auth/login">
                <Button variant="secondary">Sign in</Button>
              </Link>
            </div>
          </nav>

          <div className="max-w-3xl py-20 md:py-28">
            <p className="text-sm font-semibold uppercase tracking-wider text-emerald-300">Clinic management for Uganda</p>
            <h1 className="mt-4 text-5xl font-extrabold leading-[1.05] tracking-tight md:text-7xl">
              Patient care, <span className="text-emerald-400">organised.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-200">
              One home for everything your facility does: patient records, appointments, consultations, lab results, pharmacy,
              wards and billing. For clinics, health centres and hospitals - and it keeps working when the internet doesn&apos;t.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/auth/register">
                <Button size="lg" className="h-12 px-6 text-base">
                  Start your free trial
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Button>
              </Link>
              <Link href="/auth/login">
                <Button size="lg" variant="outline" className="h-12 border-white/30 bg-white/10 px-6 text-base text-white hover:bg-white/20 hover:text-white">
                  Sign in
                </Button>
              </Link>
            </div>
            <p className="mt-4 text-sm text-slate-300">14 days free, with every service. No payment details needed.</p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-4 px-6 py-14 md:grid-cols-3" aria-label="Why facilities choose Bulamu">
        {VALUES.map((item) => (
          <div key={item.title} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <span className="flex size-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <item.icon className="size-5" aria-hidden="true" />
            </span>
            <h2 className="mt-4 text-lg font-semibold">{item.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{item.body}</p>
          </div>
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
