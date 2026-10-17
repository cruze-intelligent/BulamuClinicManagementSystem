import Link from 'next/link';
import {
  ArrowRightLeft, BedDouble, CalendarClock, Check, ClipboardList, FileText, FlaskConical, MonitorSmartphone, Package,
  Receipt, Stethoscope, Users, UserRound, BarChart3, type LucideIcon,
} from 'lucide-react';

// Bulamu's services and plans, as cards - on the home page, and the plans on
// the Billing page too. One list, so they always say the same thing.

export type Service = { title: string; summary: string; features: string[]; icon: LucideIcon; roles: string };

export const SERVICES: Service[] = [
  { title: 'Patient records', icon: Users, roles: 'Front desk, nurses, clinicians', summary: 'One record per patient, from registration onwards.', features: ['Demographics, next of kin and consent', 'Allergies shown before prescribing', 'Visits, results, stays and referrals in one place'] },
  { title: 'Appointments', icon: CalendarClock, roles: 'Front desk, nurses, doctors', summary: "The day's list, and requests from patients.", features: ['Book patients with a named doctor', 'Requests from the Patient Portal', 'The doctor is told of each booking'] },
  { title: 'Consultations and prescribing', icon: Stethoscope, roles: 'Doctors and clinical officers', summary: 'Each visit recorded by the clinician who saw the patient.', features: ['ICD-10 coded diagnoses', 'Prescriptions checked against allergies', 'Printed, signed prescriptions'] },
  { title: 'Laboratory', icon: FlaskConical, roles: 'Lab technicians and clinicians', summary: 'Orders, results and sign-off before the patient sees them.', features: ['Standard list of tests', 'Results recorded with who entered them', 'Verified by a clinician, then locked'] },
  { title: 'Pharmacy and stock', icon: Package, roles: 'Pharmacists', summary: 'Dispensing that keeps the shelves counted.', features: ['Dispensing reduces stock', 'Low-stock and expiry alerts', 'Same medicine names as prescribing'] },
  { title: 'Wards and admissions', icon: BedDouble, roles: 'Nurses and clinicians', summary: 'Inpatients by ward and bed.', features: ['Observations and ward-round notes', 'Transfers between wards', 'Discharge summaries'] },
  { title: 'Referrals', icon: ArrowRightLeft, roles: 'Clinicians and front desk', summary: 'Refer out and receive referrals between facilities.', features: ['Referral letter with clinical summary', 'Accept, decline or complete', 'Register a referred patient in one step'] },
  { title: 'Invoices', icon: Receipt, roles: 'Administrators and doctors', summary: "Your facility's bills to patients - you collect, Bulamu records.", features: ['Fee entered with the consultation', 'Paid and outstanding at a glance', 'Printed invoices with your logo'] },
  { title: 'Reports', icon: BarChart3, roles: 'Administrators', summary: 'National reporting without retyping.', features: ['HMIS 105 monthly report', 'DHIS2 push', 'FHIR R4 export'] },
  { title: 'Patient Portal', icon: UserRound, roles: 'Patients', summary: 'Patients see their own records, on their phone.', features: ['Verified lab results and summaries', 'Appointment requests', 'Patient-approved sharing between facilities'] },
  { title: 'Works offline', icon: MonitorSmartphone, roles: 'Everyone', summary: 'Installs like an app and keeps working without internet.', features: ['Records saved on the device', 'Sent when the connection returns', 'Android, iPhone and computers'] },
  { title: 'Branded documents', icon: FileText, roles: 'Everyone', summary: 'Every printout carries your facility and who produced it.', features: ['Your logo on facility documents', 'Signed with name and role', 'QR code and page numbers on every page'] },
];

export type Plan = {
  name: string;
  price: string;
  period: string;
  summary: string;
  features: string[];
  cta: { label: string; href: string };
  highlight?: boolean;
  /** The subscription plan this card describes, for marking the current one. */
  matches?: 'TRIALING' | 'STANDARD' | 'CUSTOM';
};

export const PLANS: Plan[] = [
  {
    name: 'Free trial', price: 'UGX 0', period: 'for 14 days', matches: 'TRIALING',
    summary: 'Everything in Bulamu, to try with your own team before you pay.',
    features: ['Every service on this page', 'Unlimited staff accounts', 'No payment details needed'],
    cta: { label: 'Start free trial', href: '/auth/register' },
  },
  {
    name: 'Standard', price: 'UGX 100,000', period: 'per month', matches: 'STANDARD', highlight: true,
    summary: 'For a single facility, paid monthly through Pesapal.',
    features: ['Every service on this page', 'Unlimited staff and patients', 'Mobile money or card', 'Receipts for every payment'],
    cta: { label: 'Register your facility', href: '/auth/register' },
  },
  {
    name: 'Custom', price: 'Agreed with you', period: '', matches: 'CUSTOM',
    summary: 'For hospitals and groups with needs the Standard plan does not cover.',
    features: ['Several facilities or sites', 'Integrations and data migration', 'Training and onboarding support'],
    cta: { label: 'Talk to us', href: 'mailto:admin@bulamu.site?subject=Bulamu%20custom%20plan' },
  },
];

export function ServiceCards() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {SERVICES.map((service) => (
        <div key={service.title} className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <service.icon className="size-5" aria-hidden="true" />
            </div>
            <h3 className="font-semibold text-slate-950">{service.title}</h3>
          </div>
          <p className="mt-3 text-sm text-slate-600">{service.summary}</p>
          <ul className="mt-4 flex-1 space-y-2">
            {service.features.map((feature) => (
              <li key={feature} className="flex items-start gap-2 text-sm text-slate-700">
                <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
                {feature}
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
            <span className="font-medium text-slate-600">For:</span> {service.roles}
          </p>
        </div>
      ))}
    </div>
  );
}

/** The plans. On the Billing page, `current` marks the facility's own plan and the call to action is left out. */
export function PlanCards({ current }: { current?: 'TRIALING' | 'STANDARD' | 'CUSTOM' } = {}) {
  const inApp = current !== undefined;
  // The home page is designed light-only, so its cards stay light; inside the
  // app (Billing) they follow the viewer's theme.
  const t = (light: string, dark: string) => (inApp ? `${light} ${dark}` : light);
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {PLANS.map((plan) => {
        const isCurrent = inApp && plan.matches === current;
        return (
          <div
            key={plan.name}
            className={`relative flex flex-col rounded-xl border p-6 shadow-sm ${t('bg-white', 'dark:bg-slate-900')} ${
              isCurrent || (!inApp && plan.highlight) ? 'border-emerald-500 ring-1 ring-emerald-500' : t('border-slate-200', 'dark:border-slate-800')
            }`}
          >
            {(isCurrent || (!inApp && plan.highlight)) && (
              <span className="absolute -top-3 left-6 rounded-full bg-emerald-600 px-3 py-0.5 text-xs font-semibold text-white">
                {isCurrent ? 'Your plan' : 'Most facilities'}
              </span>
            )}
            <h3 className={`text-lg font-semibold ${t('text-slate-950', 'dark:text-slate-50')}`}>{plan.name}</h3>
            <p className="mt-3">
              <span className={`text-3xl font-bold tracking-tight ${t('text-slate-950', 'dark:text-slate-50')}`}>{plan.price}</span>
              {plan.period && <span className={`ml-1 text-sm ${t('text-slate-500', 'dark:text-slate-400')}`}>{plan.period}</span>}
            </p>
            <p className={`mt-2 text-sm ${t('text-slate-600', 'dark:text-slate-400')}`}>{plan.summary}</p>
            <ul className="mt-5 flex-1 space-y-2">
              {plan.features.map((feature) => (
                <li key={feature} className={`flex items-start gap-2 text-sm ${t('text-slate-700', 'dark:text-slate-300')}`}>
                  <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
                  {feature}
                </li>
              ))}
            </ul>
            {!inApp && (
              <Link
                href={plan.cta.href}
                className={`mt-6 inline-flex items-center justify-center rounded-md px-4 py-2.5 text-sm font-semibold ${
                  plan.highlight
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'border border-emerald-700 bg-white text-emerald-800 hover:bg-emerald-50'
                }`}
              >
                {plan.cta.label}
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}

export const ROLE_CARDS: Array<{ title: string; body: string; icon: LucideIcon }> = [
  { title: 'Administrator', body: 'Set up staff and wards, track invoices and the subscription, and run HMIS 105 / FHIR reports.', icon: ClipboardList },
  { title: 'Doctor / Clinical Officer', body: "Record diagnoses, prescriptions, lab orders, admissions and referrals against each patient's history.", icon: Stethoscope },
  { title: 'Nurse / Midwife', body: 'Register patients, record observations on the wards, and capture household outreach visits offline.', icon: CalendarClock },
  { title: 'Lab Technician', body: 'Receive test orders and record results, which a clinician verifies before the patient sees them.', icon: FlaskConical },
  { title: 'Pharmacist', body: 'Dispense prescriptions, keep stock counted, and act on low-stock and expiry alerts.', icon: Package },
  { title: 'Front desk', body: 'Register patients, book appointments and welcome referred patients.', icon: Users },
  { title: 'Patient', body: 'See their own records and verified results, request appointments, and decide which facilities may see their history.', icon: UserRound },
];
