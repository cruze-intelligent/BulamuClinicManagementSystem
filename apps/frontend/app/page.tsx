'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle2, ClipboardList, Pill, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ContactIcons } from '@/components/contact-icons';
import { CompanyName } from '@/components/company-credit';
import { getHomePath } from '@/lib/useAuth';
import { liveSessionUser } from '@/lib/staff-session';
import { PlanCards, ROLES, ServiceTiles } from '@/components/offering-cards';
import { BrandLockup } from '@/components/brand';

const VALUES = [
  { icon: ClipboardList, title: "Every patient's record in one place" },
  { icon: Pill, title: 'From the front desk to the pharmacy' },
  { icon: WifiOff, title: 'Works without internet' },
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
        <div aria-hidden="true" className="pointer-events-none absolute -right-48 -top-40 size-[36rem] rounded-full border border-emerald-400/15" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-16 size-[24rem] rounded-full border border-emerald-400/15" />
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

          <div className="grid items-center gap-12 py-14 md:py-20 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
          <div className="max-w-3xl">
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
            <ul className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-sm text-slate-200">
              {VALUES.map((item) => (
                <li key={item.title} className="flex items-center gap-2">
                  <item.icon className="size-4 text-emerald-300" aria-hidden="true" />
                  {item.title}
                </li>
              ))}
            </ul>
          </div>

          {/* Free photo (Pexels, Tessy Agbonome), served from this site as small WebP files - lazily, so phones (which never show it) never download it. */}
          <figure className="relative hidden lg:block">
            <img
              src="/images/hero-clinician-760.webp"
              srcSet="/images/hero-clinician-480.webp 480w, /images/hero-clinician-760.webp 760w"
              sizes="(min-width: 1280px) 26rem, 22rem"
              width={760}
              height={912}
              alt="A smiling clinician reading a patient's file"
              className="aspect-[5/6] w-full rounded-3xl object-cover shadow-2xl ring-1 ring-white/10"
              decoding="async"
              loading="lazy"
            />
            <figcaption className="absolute -left-8 bottom-10 flex items-center gap-3 rounded-2xl bg-white px-4 py-3 text-slate-900 shadow-xl">
              <span className="flex size-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="size-5" aria-hidden="true" />
              </span>
              <span className="text-sm leading-tight">
                <span className="block font-semibold">Lab result verified</span>
                <span className="block text-slate-500">Ready in the patient&apos;s record</span>
              </span>
            </figcaption>
          </figure>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-14" aria-labelledby="services">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Services</p>
        <h2 id="services" className="mt-1 text-3xl font-semibold tracking-tight">Everything a facility runs on, in one system</h2>
        <p className="mt-2 max-w-2xl text-slate-600">Every service is in every plan, and each member of staff sees only what their role needs.</p>
        <div className="mt-8"><ServiceTiles /></div>
        <div className="mt-8 flex flex-wrap items-center gap-2" aria-label="Who uses Bulamu">
          <span className="mr-1 text-sm font-medium text-slate-500">Everyone gets their own view:</span>
          {ROLES.map((role) => (
            <span key={role} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-700">{role}</span>
          ))}
        </div>
      </section>

      <section className="bg-slate-50 py-14" aria-labelledby="plans"><div className="mx-auto max-w-7xl px-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Plans</p>
        <h2 id="plans" className="mt-1 text-3xl font-semibold tracking-tight">Start free, then one simple monthly price</h2>
        <p className="mt-2 max-w-2xl text-slate-600">Try everything for 14 days. Paying early never costs you trial days - your paid month starts when the trial ends.</p>
        <div className="mt-10"><PlanCards /></div>
      </div></section>
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
