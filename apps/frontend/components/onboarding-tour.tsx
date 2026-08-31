'use client';

import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  DatabaseZap,
  ShieldCheck,
  Stethoscope,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const TOUR_KEY = 'bulamu_onboarding_completed';

const steps = [
  {
    title: 'Welcome to Bulamu',
    body: 'Bulamu is now positioned as an operating system for clinics, health centres, hospitals, laboratories, pharmacies, mobile units, and community outreach teams.',
    icon: ShieldCheck,
  },
  {
    title: 'Register the facility',
    body: 'Super admins authorize each medical facility, choose the facility type, create the first admin account, and can suspend or reactivate facilities from God Mode.',
    icon: ClipboardList,
  },
  {
    title: 'Run the care workflow',
    body: 'Staff register patients, book appointments, capture consultations, prescribe medicines, request lab tests, invoice visits, and keep a searchable clinical history.',
    icon: Stethoscope,
  },
  {
    title: 'Work offline first',
    body: 'The PWA installs to device home screens, caches the app shell, stores records in IndexedDB, queues mutations while offline, and syncs when connectivity returns.',
    icon: DatabaseZap,
  },
  {
    title: 'Report into the ecosystem',
    body: 'Reports cover facility metrics, HMIS 105 outpatient surveillance, essential medicine alerts, and FHIR patient bundle export for interoperability work.',
    icon: BarChart3,
  },
];

export function openOnboardingTour() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('bulamu-open-onboarding'));
}

export function OnboardingTour() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const completed = localStorage.getItem(TOUR_KEY);
    if (!completed) setOpen(true);

    const reopen = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener('bulamu-open-onboarding', reopen);
    return () => window.removeEventListener('bulamu-open-onboarding', reopen);
  }, []);

  if (!open) return null;

  const current = steps[step];
  const Icon = current.icon;
  const isLast = step === steps.length - 1;

  const close = () => {
    localStorage.setItem(TOUR_KEY, 'true');
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-sm">
      <section className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 p-6">
          <div className="flex items-center gap-4">
            <div className="flex size-11 items-center justify-center rounded-md bg-emerald-700 text-white">
              <Icon className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                Step {step + 1} of {steps.length}
              </p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{current.title}</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Close walkthrough"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-6">
          <p className="text-base leading-7 text-slate-600">{current.body}</p>
          <div className="mt-6 grid grid-cols-5 gap-2">
            {steps.map((item, index) => (
              <div
                key={item.title}
                className={`h-1.5 rounded-full ${index <= step ? 'bg-emerald-700' : 'bg-slate-200'}`}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 p-6">
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
