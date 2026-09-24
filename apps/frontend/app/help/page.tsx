'use client';

import {
  BarChart3,
  BookOpen,
  CalendarCheck,
  CreditCard,
  DatabaseZap,
  FileQuestion,
  GraduationCap,
  MonitorSmartphone,
  ShieldCheck,
  Stethoscope,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { openOnboardingTour } from '@/components/onboarding-tour';
import { CommentsSection } from '@/components/comments-section';

type Faq = { question: string; answer: string };
type FaqCategory = { title: string; icon: typeof Users; items: Faq[] };

const faqCategories: FaqCategory[] = [
  {
    title: 'Getting started',
    icon: BookOpen,
    items: [
      {
        question: 'How do I sign in?',
        answer:
          'Use the email address and password your facility administrator created for you. If your facility is new, the administrator account is created first, and it then creates accounts for clinicians and staff.',
      },
      {
        question: 'Can I install Bulamu on my phone or tablet?',
        answer:
          'Yes. Bulamu is an installable Progressive Web App. In a supported browser, use the install or "Add to Home Screen" option to add it like a native app, including offline access.',
      },
      {
        question: 'I forgot my password - what do I do?',
        answer:
          'Use "Forgot password" on the sign-in page. A reset link is emailed to your account address and expires after one hour.',
      },
    ],
  },
  {
    title: 'Facility administration',
    icon: ShieldCheck,
    items: [
      {
        question: 'How does a new facility get approved?',
        answer:
          'A facility registers through the public sign-up form. An administrator then reviews the request, confirms the facility type, and approves or rejects it. Approval starts a two-week free trial and creates the facility\'s first admin account.',
      },
      {
        question: 'How do I add staff accounts to my facility?',
        answer:
          'From Staff in the sidebar, an admin can create accounts for doctors, nurses, pharmacists, and front desk staff, and deactivate accounts for staff who leave.',
      },
      {
        question: 'How do I manage my facility\'s subscription?',
        answer:
          'From Billing, an admin can see the current trial or subscription status and pay through Pesapal. Payment receipts are emailed automatically and stay available for download under Payment History.',
      },
    ],
  },
  {
    title: 'Patients & clinical care',
    icon: Stethoscope,
    items: [
      {
        question: 'How do I register a new patient?',
        answer:
          'From Patients, use Register Patient to capture demographics, location, next of kin, and consent. Registration works offline and syncs automatically once a connection is available.',
      },
      {
        question: 'How do I book an appointment and record a consultation?',
        answer:
          'Book a visit from Appointments, then record the consultation once the patient is seen: presenting complaints, one or more diagnoses (search by name or ICD-10 code, and mark a diagnosis Suspected while it is still a working diagnosis), your assessment and plan, and each prescription with its strength, route, dose, frequency and duration. A printable prescription is available from the consultation history. Each consultation can generate an invoice automatically.',
      },
      {
        question: 'Can I track reproductive health information?',
        answer:
          'Yes. For female patients, a patient\'s record can include cycle history, family planning method, and pregnancy status, which also feeds directly into HMIS reporting.',
      },
      {
        question: 'How do I refer a patient to another facility?',
        answer:
          'From Referrals, send a patient to another facility in the network with a reason and supporting notes. The receiving facility sees the referral in its own queue.',
      },
      {
        question: 'Can I upload documents to a patient\'s record?',
        answer:
          'Yes. From a patient\'s history page, upload lab results, consent forms, ID copies, or referral letters (up to 10 MB each), and download them again anytime.',
      },
    ],
  },
  {
    title: 'Pharmacy & laboratory',
    icon: Users,
    items: [
      {
        question: 'How do I manage medicine stock?',
        answer:
          'From Inventory, track medicine quantities and set reorder levels. Items at or below their reorder level are flagged automatically so restocking isn\'t missed.',
      },
      {
        question: 'How do I request and record lab tests?',
        answer:
          'From Lab Tests, request a test for a patient and record results once they\'re available. Completed results appear in the patient\'s consultation history.',
      },
    ],
  },
  {
    title: 'Reports & interoperability',
    icon: BarChart3,
    items: [
      {
        question: 'What is the HMIS 105 report?',
        answer:
          'It\'s Uganda\'s standard outpatient reporting format, generated automatically from Bulamu\'s recorded data across attendance, epidemic surveillance, essential medicines, family planning, maternal health, and referrals.',
      },
      {
        question: 'What is the FHIR export for?',
        answer:
          'It exports patient, encounter, and observation records in HL7 FHIR R4 format, the standard used to interoperate with systems like OpenMRS, Bahmni, and UgandaEMR.',
      },
      {
        question: 'What does the DHIS2 push do?',
        answer:
          'For facilities with DHIS2 integration configured, this pushes the current HMIS 105 report directly into Uganda\'s national DHIS2 system instead of filing it manually.',
      },
    ],
  },
  {
    title: 'Offline access & sync',
    icon: DatabaseZap,
    items: [
      {
        question: 'Does Bulamu work without an internet connection?',
        answer:
          'Yes, by design. Patient, appointment, consultation, and inventory records are stored on the device and queued for sync, so day-to-day work continues uninterrupted during outages.',
      },
      {
        question: 'How do I know if my data has synced?',
        answer:
          'Sync Activity shows a live sync status badge along with a full audit and conflict log for every record that has been pushed or pulled.',
      },
      {
        question: 'What happens if the same record is edited offline in two places?',
        answer:
          'Bulamu resolves conflicts deterministically by timestamp - the most recent edit wins, and every conflict is logged and visible in Sync Activity for review.',
      },
    ],
  },
  {
    title: 'Account & data security',
    icon: CreditCard,
    items: [
      {
        question: 'Who can see patient records?',
        answer:
          'Only signed-in staff at the same facility, scoped by role. Clinical roles see clinical data; front desk and billing roles see only what their workflow needs.',
      },
      {
        question: 'Is patient data encrypted and audited?',
        answer:
          'Yes. Connections are encrypted in transit, and every write to patient, reproductive health, user, and invoice records is captured in an audit log with who made the change and when.',
      },
    ],
  },
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
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
            Guidance for using Bulamu
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
            Answers for day-to-day use, staff onboarding, and facility administration.
          </p>
        </div>
        <Button type="button" onClick={openOnboardingTour}>
          <GraduationCap className="size-4" aria-hidden="true" />
          Replay walkthrough
        </Button>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
        {[
          { title: 'Installable app', body: 'Install Bulamu from your browser and keep working offline.', icon: MonitorSmartphone },
          { title: 'Facility administration', body: 'Approve facilities, manage staff, and monitor activity from one console.', icon: ShieldCheck },
          { title: 'National reporting', body: 'Generate HMIS 105 summaries and export FHIR patient bundles.', icon: CalendarCheck },
        ].map((item) => (
          <Card key={item.title} className="rounded-lg p-5">
            <item.icon className="size-5 text-emerald-700" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold text-slate-950 dark:text-slate-50">{item.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{item.body}</p>
          </Card>
        ))}
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        {faqCategories.map((category) => (
          <Card key={category.title} className="rounded-lg p-5">
            <div className="flex items-center gap-2">
              <category.icon className="size-5 text-emerald-700" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">{category.title}</h2>
            </div>
            <div className="mt-3 divide-y divide-slate-200 dark:divide-slate-800">
              {category.items.map((faq) => (
                <div key={faq.question} className="py-3">
                  <h3 className="font-medium text-slate-950 dark:text-slate-50">{faq.question}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-slate-600 dark:text-slate-400">{faq.answer}</p>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </section>

      <CommentsSection
        entityType="FEEDBACK"
        title="Send feedback or report an issue"
        placeholder="Tell us what's working, what's confusing, or what's broken..."
      />
    </main>
  );
}
