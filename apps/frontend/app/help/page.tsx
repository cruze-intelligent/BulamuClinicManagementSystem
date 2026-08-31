'use client';

import {
  BarChart3,
  CheckCircle2,
  DatabaseZap,
  FileQuestion,
  GraduationCap,
  MonitorSmartphone,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { openOnboardingTour } from '@/components/onboarding-tour';

const faqs = [
  {
    question: 'What facility types does Bulamu support?',
    answer:
      'Bulamu supports clinics, Health Centre II, III and IV facilities, hospitals, laboratories, pharmacies, mobile units, and community outreach teams.',
  },
  {
    question: 'Does it work without internet?',
    answer:
      'Yes. The app is installable as a PWA, caches the core app shell, stores operational records in IndexedDB, and queues updates until a connection is available.',
  },
  {
    question: 'What should be shown in the two-week evaluation?',
    answer:
      'Start in God Mode, authorize a facility, create the facility admin, register patients, book visits, capture consultations, add medicines and lab tests, then show HMIS 105 and FHIR export.',
  },
  {
    question: 'How does this align with the research PDF?',
    answer:
      'The current implementation maps to DHIS2-facing reporting, HMIS 105 surveillance, UgandaEMR/OpenMRS interoperability through FHIR exports, offline-first sync, and tiered rural facility deployment.',
  },
  {
    question: 'Who can authorize facilities?',
    answer:
      'Only SUPER_ADMIN users can access God Mode, create facility accounts, choose facility type, and suspend or reactivate a facility.',
  },
];

const checklist = [
  'Facility-type registration and authorization',
  'Role-based workflows for admins, clinicians, nurses, pharmacists, and staff',
  'Offline-capable patient, appointment, consultation, lab, and inventory workflows',
  'Manual and automatic sync status visibility',
  'HMIS 105 outpatient report and epidemic surveillance categories',
  'FHIR R4 patient bundle export for interoperability',
  'Deployment path for cloud API and edge medical facility environments',
];

export default function HelpPage() {
  return (
    <main className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold uppercase text-emerald-700">
            <FileQuestion className="size-4" aria-hidden="true" />
            Help & FAQ
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Evaluation guidance and system readiness</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Use this page during onboarding, stakeholder evaluation, and facility training to verify the operating model.
          </p>
        </div>
        <Button type="button" onClick={openOnboardingTour}>
          <GraduationCap className="size-4" aria-hidden="true" />
          Replay walkthrough
        </Button>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          { title: 'Installable PWA', body: 'Use the install prompt in supported browsers and continue work offline.', icon: MonitorSmartphone },
          { title: 'Super Admin God Mode', body: 'Authorize, suspend, and monitor every facility from one console.', icon: ShieldCheck },
          { title: 'National Reporting', body: 'Prepare HMIS 105 summaries and export FHIR patient bundles.', icon: BarChart3 },
        ].map((item) => (
          <Card key={item.title} className="rounded-lg p-5">
            <item.icon className="size-5 text-emerald-700" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold text-slate-950">{item.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{item.body}</p>
          </Card>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card className="rounded-lg p-5">
          <h2 className="text-lg font-semibold text-slate-950">Frequently asked questions</h2>
          <div className="mt-4 divide-y divide-slate-200">
            {faqs.map((faq) => (
              <div key={faq.question} className="py-4">
                <h3 className="font-medium text-slate-950">{faq.question}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{faq.answer}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="rounded-lg p-5">
          <div className="flex items-center gap-2">
            <DatabaseZap className="size-5 text-emerald-700" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-slate-950">Research sync checklist</h2>
          </div>
          <div className="mt-4 space-y-3">
            {checklist.map((item) => (
              <div key={item} className="flex gap-2 text-sm text-slate-700">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700" aria-hidden="true" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </Card>
      </section>
    </main>
  );
}
