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
import { InstallGuide } from '@/components/install-guide';

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
          'Yes - straight from the browser, no app store needed: Chrome on Android and computers, Safari on iPhone and iPad. The step-by-step guide for each device is at the top of this page (and at bulamu.site/install for staff who have not signed in yet). Installed, it keeps working without internet.',
      },
      {
        question: 'How long do I stay signed in?',
        answer:
          'For 12 hours - a full shift. Tick "Keep me signed in for 30 days" when signing in to stay signed in on that device for a month; use it only on a device that is yours. Changing or resetting your password signs you out everywhere. Offline, you are never signed out in the middle of work - it waits until the device is back online.',
      },
      {
        question: "How do I correct a patient's details, or remove a patient registered by mistake?",
        answer:
          'Open the patient and choose Edit details to correct their name, phone, address or next of kin - front desk, nurses, doctors and administrators can do this, and each change is recorded. Administrators also see Delete patient, for test or duplicate registrations: the patient leaves every list, but nothing is erased.',
      },
      {
        question: 'Does Bulamu collect money from our patients?',
        answer:
          "No. Invoices are your facility's own bills to your patients: a fee entered when recording a consultation creates the invoice, and your facility collects the payment and marks it paid under Invoices. Bulamu only keeps the record. The only payment Bulamu takes is your facility's subscription, through Pesapal.",
      },
      {
        question: 'How do I put our logo on documents?',
        answer:
          'An administrator opens Facility in the menu and uploads a PNG or JPEG under 500 KB. It is printed on your invoices, prescriptions, referral letters and discharge summaries, which are also signed with the name and role of the clinician responsible and say who printed them.',
      },
      {
        question: 'How are lab results recorded and checked?',
        answer:
          "A clinician orders the test (offline too) and the lab technician - or a nurse where there is none - records the result on the Lab page. The clinician who ordered it is asked to verify it; only then is the patient told, and the result is locked. A verified result can be amended by a doctor or administrator, with a reason that is kept in the activity log. Every result shows who entered and who verified it.",
      },
      {
        question: 'How do I manage my staff accounts?',
        answer:
          'Administrators use Staff in the menu to add people, correct a name or email, change a role, reset a forgotten password, and deactivate anyone who has left (they can be reactivated). An account added by mistake can be deleted; one someone has worked under is deactivated instead, so records keep showing who made them.',
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
          'From Patients, use Register Patient to capture demographics, location, next of kin, and consent. Registration works without internet and is sent automatically once a connection is available.',
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
          'From Referrals, choose the patient and the receiving facility, give the reason, the urgency (routine, urgent or emergency) and a clinical summary, and confirm that the patient agreed. Print the referral letter for the patient to carry. The receiving facility is notified at once, and you are told when they accept, decline or complete it. A patient referred to you can be registered at your facility in one step from the referral.',
      },
      {
        question: 'How do admissions and wards work?',
        answer:
          'An admin sets up the wards and their beds under Wards. Clinicians admit a patient to a bed, nurses record observations (temperature, pulse, BP, respiratory rate, SpO2, weight) and notes, and patients can be moved between wards. A doctor or clinical officer discharges the patient - home, or by referral - with a final diagnosis, a summary and follow-up instructions, and prints the discharge summary.',
      },
      {
        question: 'Can I see a patient\'s records from another facility?',
        answer:
          'Only if the patient approves. If they have a Bulamu Patient Portal account linked to your facility, ask from their record: they approve with their own password or a code sent to them, or later from their portal. You then see their allergies, diagnoses, medicines, lab results and hospital stays from other facilities - never reproductive-health records, private clinical notes, documents or bills. Every view is logged, and the patient can stop sharing at any time.',
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
          'From Inventory, track medicine quantities, reorder levels and expiry dates. Pharmacists and admins are notified when a medicine falls to its reorder level, when it runs out, when it is within two months of expiry, and when it has expired.',
      },
      {
        question: 'How do I request and record lab tests?',
        answer:
          'From Lab Tests, request a test for a patient - the nurses running the lab are notified. When the result is recorded, the clinician who ordered it is notified straight away, and the patient too if they use the Patient Portal.',
      },
    ],
  },
  {
    title: 'Reports',
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
          'It exports your patients\' records in FHIR, the international standard format for health records, so they can be moved into other systems such as UgandaEMR, OpenMRS or Bahmni.',
      },
      {
        question: 'What does the DHIS2 push do?',
        answer:
          'For facilities with DHIS2 integration configured, this pushes the current HMIS 105 report directly into Uganda\'s national DHIS2 system instead of filing it manually.',
      },
    ],
  },
  {
    title: 'Working without internet',
    icon: DatabaseZap,
    items: [
      {
        question: 'Does Bulamu work without an internet connection?',
        answer:
          'Yes. Patients, appointments, visits and stock are saved on the device and sent automatically when the connection returns, so day-to-day work carries on during outages.',
      },
      {
        question: 'How do I know my work has been sent?',
        answer:
          'The badge at the bottom of the screen shows "Synced", "Offline" or how many changes are waiting to be sent. The Activity page lists what has been recorded and any changes that clashed.',
      },
      {
        question: 'What happens if the same record is edited offline in two places?',
        answer:
          'If two people change the same record while offline, the most recent change is kept, and the clash is listed on the Activity page so it can be checked.',
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
          'Only signed-in staff at the same facility, scoped by role. Clinical roles see clinical data; front desk and billing roles see only what their workflow needs. Another facility sees nothing unless the patient approves sharing, and even then only clinicians can read it.',
      },
      {
        question: 'Which notifications will I get?',
        answer:
          'Each role is told about what concerns it: pharmacists about prescriptions and stock; nurses about lab orders, admissions and appointment requests; doctors about their own appointments, results of tests they ordered, referrals and admissions; front desk about appointment requests and arriving referrals; admins about stock, referrals, discharges, notes and the subscription. The Notifications page lists everything that applies to you, and lets you switch individual emails off.',
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
      </header>

      <Card className="flex flex-col gap-4 rounded-lg border-emerald-200 bg-emerald-50/60 p-5 sm:flex-row sm:items-center sm:justify-between dark:border-emerald-900 dark:bg-emerald-950/30">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-emerald-700 text-white">
            <GraduationCap className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Guided tour</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">
              A one-minute tour that points at each tool you use, for your role. It opened by itself the first time you signed in;
              take it again here whenever you like.
            </p>
          </div>
        </div>
        <Button type="button" onClick={openOnboardingTour} className="shrink-0">
          Take the guided tour
        </Button>
      </Card>

      <InstallGuide />

      <section className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
        {[
          { title: 'Installable app', body: 'Install Bulamu from your browser and keep working offline - see the guide above.', icon: MonitorSmartphone },
          { title: 'Facility administration', body: 'Approve facilities, manage staff, and monitor activity from one console.', icon: ShieldCheck },
          { title: 'National reporting', body: 'Produce the monthly HMIS 105 report and export patient records for other health systems.', icon: CalendarCheck },
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
