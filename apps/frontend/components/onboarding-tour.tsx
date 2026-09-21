'use client';

import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  DatabaseZap,
  FlaskConical,
  HelpCircle,
  Package,
  ShieldCheck,
  Stethoscope,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/useAuth';

const TOUR_KEY_PREFIX = 'bulamu_onboarding_completed';

type Step = { title: string; body: string; icon: LucideIcon };

const welcomeStep: Step = {
  title: 'Welcome to Bulamu',
  body: 'Bulamu is a management system for clinics, health centres, hospitals, laboratories, imaging centres, pharmacies, mobile units, and community outreach teams.',
  icon: ShieldCheck,
};

const offlineStep: Step = {
  title: 'Work offline first',
  body: 'The PWA installs to device home screens, caches the app shell, stores records in IndexedDB, queues mutations while offline, and syncs when connectivity returns.',
  icon: DatabaseZap,
};

const helpStep: Step = {
  title: 'Get help anytime',
  body: 'Answers to common questions are in Help & FAQ from the sidebar. If something looks wrong, reach out to your facility administrator.',
  icon: HelpCircle,
};

const roleSteps: Record<string, Step[]> = {
  SUPER_ADMIN: [
    {
      title: 'Authorize facilities',
      body: 'Review self-registered facilities in Facility Management, approve or reject them, and each approved facility is issued its own Facility ID and 2-week free trial.',
      icon: ClipboardList,
    },
    {
      title: 'Manage the network',
      body: 'Suspend, reactivate, or permanently delete a facility from Facility Management, and monitor national activity, revenue, and subscriptions from the overview dashboard.',
      icon: BarChart3,
    },
  ],
  ADMIN: [
    {
      title: 'Set up your team',
      body: 'Create staff accounts and assign roles - Doctor, Nurse, Pharmacist, or Front Desk - from Staff.',
      icon: Users,
    },
    {
      title: 'Track billing',
      body: 'Watch your free trial countdown, subscribe through Pesapal when it ends, and download subscription receipts from Billing.',
      icon: CreditCard,
    },
    {
      title: 'Review reports',
      body: 'HMIS 105 outpatient reporting, essential medicine alerts, and FHIR patient bundle export are available from Reports.',
      icon: BarChart3,
    },
  ],
  DOCTOR: [
    {
      title: 'Run consultations',
      body: 'Open a patient from Patients or an appointment from Appointments to record diagnoses, prescriptions, and lab requests tied to their history.',
      icon: Stethoscope,
    },
    {
      title: 'Order lab tests',
      body: 'Request and review lab results from Lab Tests, linked directly to the patient record.',
      icon: FlaskConical,
    },
  ],
  NURSE: [
    {
      title: 'Coordinate patient care',
      body: 'Register patients, manage the day\'s schedule from Appointments, and support consultations and lab workflow.',
      icon: CalendarClock,
    },
    {
      title: 'Capture household visits',
      body: 'For community outreach and mobile unit work, log household visits from Household Visit - it works fully offline.',
      icon: ClipboardList,
    },
  ],
  PHARMACIST: [
    {
      title: 'Manage the pharmacy',
      body: 'Track medicine stock, set reorder levels, and fulfil prescriptions written during consultations from Inventory.',
      icon: Package,
    },
  ],
  STAFF: [
    {
      title: 'Register and book patients',
      body: 'Register new patients and schedule appointments from the front desk using Patients and Appointments.',
      icon: Users,
    },
  ],
};

function stepsForRole(role: string | undefined): Step[] {
  const middle = (role && roleSteps[role]) || roleSteps.STAFF;
  const closing = role === 'ADMIN' || role === 'SUPER_ADMIN' ? offlineStep : helpStep;
  return [welcomeStep, ...middle, closing];
}

export function openOnboardingTour() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('bulamu-open-onboarding'));
}

export function OnboardingTour() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  const role = user?.role as string | undefined;
  const tourKey = `${TOUR_KEY_PREFIX}_${role || 'guest'}`;
  const steps = stepsForRole(role);

  useEffect(() => {
    const completed = localStorage.getItem(tourKey);
    if (!completed) setOpen(true);

    const reopen = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener('bulamu-open-onboarding', reopen);
    return () => window.removeEventListener('bulamu-open-onboarding', reopen);
  }, [tourKey]);

  if (!open || !role) return null;

  const current = steps[step];
  const Icon = current.icon;
  const isLast = step === steps.length - 1;

  const close = () => {
    localStorage.setItem(tourKey, 'true');
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-sm">
      <section className="w-full max-w-2xl rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 dark:border-slate-800 p-6">
          <div className="flex items-center gap-4">
            <div className="flex size-11 items-center justify-center rounded-md bg-emerald-700 text-white">
              <Icon className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                Step {step + 1} of {steps.length}
              </p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">{current.title}</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-md p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 hover:dark:bg-slate-800 hover:text-slate-900 hover:dark:text-slate-100"
            aria-label="Close walkthrough"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-6">
          <p className="text-base leading-7 text-slate-600 dark:text-slate-400">{current.body}</p>
          <div className="mt-6 grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
            {steps.map((item, index) => (
              <div
                key={item.title}
                className={`h-1.5 rounded-full ${index <= step ? 'bg-emerald-700' : 'bg-slate-200 dark:bg-slate-700'}`}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 p-6">
          <Button
            type="button"
            variant="outline"
            disabled={step === 0}
            onClick={() => setStep((value) => Math.max(0, value - 1))}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (isLast) close();
              else setStep((value) => value + 1);
            }}
          >
            {isLast ? (
              <>
                <CheckCircle2 className="size-4" aria-hidden="true" />
                Start using Bulamu
              </>
            ) : (
              <>
                Next
                <ArrowRight className="size-4" aria-hidden="true" />
              </>
            )}
          </Button>
        </div>
      </section>
    </div>
  );
}
