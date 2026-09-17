'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Building2, CheckCircle2, MonitorSmartphone, ShieldCheck, Stethoscope } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ContactIcons } from '@/components/contact-icons';
import { CompanyName } from '@/components/company-credit';

const facilityTypes = [
  'Clinic',
  'Health Centre II',
  'Health Centre III',
  'Health Centre IV',
  'Hospital',
  'Laboratory',
  'Pharmacy',
  'Community Outreach',
  'Mobile Unit',
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
  const [showAccessModal, setShowAccessModal] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    facilityName: '',
    facilityType: 'Clinic',
    contactPerson: '',
    phone: '',
    email: '',
    preferredPlan: 'PROFESSIONAL',
    message: '',
  });

  useEffect(() => {
    const user = localStorage.getItem('user');
    if (user) router.push('/dashboard');
  }, [router]);

  const handleAccessRequest = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await response.json();
      if (data.success) {
        setSubmitted(true);
      } else {
        alert('Error submitting request. Please try again.');
      }
    } catch {
      alert('Error connecting to server');
    }
  };

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
      {showAccessModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 backdrop-blur-sm">
          <Card className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg p-6">
            {!submitted ? (
              <>
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight">Request evaluation access</h2>
                    <p className="mt-1 text-sm text-slate-500">Tell us what type of medical facility you operate.</p>
                  </div>
                  <button type="button" onClick={() => setShowAccessModal(false)} className="rounded-md px-3 py-1 text-slate-500 hover:bg-slate-100">
                    Close
                  </button>
                </div>
                <form onSubmit={handleAccessRequest} className="mt-5 grid gap-4 md:grid-cols-2">
                  <div>
                    <Label htmlFor="facilityName">Facility name</Label>
                    <Input id="facilityName" value={formData.facilityName} onChange={(e) => setFormData({ ...formData, facilityName: e.target.value })} required />
                  </div>
                  <div>
                    <Label htmlFor="facilityType">Facility type</Label>
                    <select
                      id="facilityType"
                      className="mt-2 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                      value={formData.facilityType}
                      onChange={(e) => setFormData({ ...formData, facilityType: e.target.value })}
                    >
                      {facilityTypes.map((type) => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="contactPerson">Contact person</Label>
                    <Input id="contactPerson" value={formData.contactPerson} onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })} required />
                  </div>
                  <div>
                    <Label htmlFor="phone">Phone number</Label>
                    <Input id="phone" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} required />
                  </div>
                  <div className="md:col-span-2">
                    <Label htmlFor="email">Email address</Label>
                    <Input id="email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} required />
                  </div>
                  <div className="md:col-span-2">
                    <Label htmlFor="message">Evaluation goals</Label>
                    <textarea
                      id="message"
                      className="mt-2 min-h-24 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                      value={formData.message}
                      onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                      placeholder="Tell us the workflows your facility wants to evaluate."
                    />
                  </div>
                  <Button type="submit" className="md:col-span-2">
                    Submit access request
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Button>
                </form>
              </>
            ) : (
              <div className="py-10 text-center">
                <CheckCircle2 className="mx-auto size-12 text-emerald-700" aria-hidden="true" />
                <h2 className="mt-4 text-2xl font-semibold">Access request received</h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
                  The next step is administrator authorization, facility setup, and a guided two-week evaluation.
                </p>
                <Button className="mt-6" onClick={() => setShowAccessModal(false)}>Done</Button>
              </div>
            )}
          </Card>
        </div>
      )}

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
              Bulamu supports clinics, health centres, hospitals, laboratories, pharmacies, outreach teams, and mobile
              units with offline-first operations, national reporting, and centralized administrative governance.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" onClick={() => setShowAccessModal(true)}>
                Request evaluation access
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
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
            <Link href="/legal/refund-policy" className="hover:text-emerald-700 hover:underline">Refund Policy</Link>
            <ContactIcons />
          </div>
        </div>
      </footer>
    </main>
  );
}
