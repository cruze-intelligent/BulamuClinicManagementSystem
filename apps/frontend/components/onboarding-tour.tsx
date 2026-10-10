'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/useAuth';
import { useSidebar } from '@/lib/sidebar-provider';
import { TOUR_STEPS, TourStep } from '@/lib/tour-steps';

/**
 * The guided walkthrough. It opens by itself only on a user's very first
 * sign-in (the server remembers when they finished or skipped it, so signing
 * out or using another device does not bring it back), and can be replayed at
 * any time from Help & FAQ.
 *
 * Each step points at the real control it describes - the menu item, the bell,
 * the theme switch - by highlighting the element tagged data-tour="...". On a
 * phone the menu drawer is opened so the highlighted item is visible.
 */

export function openOnboardingTour() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('bulamu-open-onboarding'));
}

type Rect = { top: number; left: number; width: number; height: number };

function findTarget(target: string | undefined): HTMLElement | null {
  if (!target) return null;
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`));
  return candidates.find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth;
  }) ?? null;
}

async function markCompleted() {
  try {
    const raw = localStorage.getItem('user');
    if (raw) {
      const user = JSON.parse(raw);
      user.tourCompletedAt = new Date().toISOString();
      localStorage.setItem('user', JSON.stringify(user));
    }
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/users/me/tour-completed`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });
  } catch {
    // Offline: the local flag keeps it closed on this device; the server is told next time.
  }
}

export function OnboardingTour() {
  const { user } = useAuth();
  const { openMobile, closeMobile } = useSidebar();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  const role = user?.role as string | undefined;
  const steps: TourStep[] = useMemo(() => (role ? TOUR_STEPS[role] ?? TOUR_STEPS.STAFF : []), [role]);
  // Only an explicit null from the server means "never done it". A profile
  // saved before this existed has no field at all - that is not a first sign-in.
  const firstSignIn = !!user && user.tourCompletedAt === null;

  // First sign-in only; replay on request from Help & FAQ.
  useEffect(() => {
    if (firstSignIn) {
      setIndex(0);
      setOpen(true);
    }
    const reopen = () => {
      setIndex(0);
      setOpen(true);
    };
    window.addEventListener('bulamu-open-onboarding', reopen);
    return () => window.removeEventListener('bulamu-open-onboarding', reopen);
  }, [firstSignIn]);

  const step = steps[index];

  // Find and track the highlighted element (it moves when the drawer slides in, on scroll and resize).
  useLayoutEffect(() => {
    if (!open || !step) return;
    const mobile = window.innerWidth < 1024;
    setIsMobile(mobile);
    // Everything the tour points at lives in the menu, which is a drawer on a phone.
    if (mobile && step.target) openMobile();
    else if (mobile) closeMobile();

    let frame = 0;
    const measure = () => {
      const el = findTarget(step.target);
      if (!el) return setRect(null);
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    const settle = window.setTimeout(() => {
      findTarget(step.target)?.scrollIntoView({ block: 'nearest' });
      measure();
    }, mobile ? 260 : 30);
    const onMove = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.clearTimeout(settle);
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, step, openMobile, closeMobile]);

  const close = useCallback(() => {
    setOpen(false);
    setRect(null);
    if (window.innerWidth < 1024) closeMobile();
    void markCompleted();
  }, [closeMobile]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(steps.length - 1, i + 1));
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, steps.length]);

  if (!open || !step || !role) return null;

  const isLast = index === steps.length - 1;
  const Icon = step.icon;
  const pad = 6;

  // Card placement: beside the highlighted item on a wide screen, docked at the
  // bottom on a phone, centred when the step points at nothing in particular.
  let cardStyle: React.CSSProperties;
  if (rect && !isMobile) {
    const width = 380;
    const right = rect.left + rect.width + pad + 16;
    const fitsRight = right + width < window.innerWidth - 16;
    const top = Math.min(Math.max(16, rect.top - 24), window.innerHeight - 320);
    cardStyle = fitsRight
      ? { position: 'fixed', top, left: right, width }
      : { position: 'fixed', top: Math.min(rect.top + rect.height + pad + 12, window.innerHeight - 320), left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)), width };
  } else if (rect && isMobile) {
    cardStyle = { position: 'fixed', left: 12, right: 12, bottom: 12 };
  } else {
    cardStyle = { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 'min(560px, calc(100vw - 24px))' };
  }

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {rect ? (
        // The spotlight: everything outside the highlighted control is dimmed.
        <div
          aria-hidden="true"
          className="pointer-events-none fixed rounded-lg ring-2 ring-emerald-400 transition-all duration-200"
          style={{
            top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2,
            boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.6)',
          }}
        />
      ) : (
        <div aria-hidden="true" className="fixed inset-0 bg-slate-950/60 backdrop-blur-[1px]" />
      )}

      <section
        style={cardStyle}
        className="z-[71] rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex items-start gap-3 p-4 pb-2">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-emerald-700 text-white">
            <Icon className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
              Step {index + 1} of {steps.length}{step.where ? ` - ${step.where}` : ''}
            </p>
            <h2 id="tour-title" className="mt-0.5 text-lg font-semibold leading-snug text-slate-950 dark:text-slate-50">{step.title}</h2>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            aria-label="Close walkthrough"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="px-4 pb-3">
          <p className="text-sm leading-6 text-slate-700 dark:text-slate-300">{step.body}</p>
          {step.tips && (
            <ul className="mt-2 space-y-1 text-sm leading-6 text-slate-600 dark:text-slate-400">
              {step.tips.map((tip) => (
                <li key={tip} className="flex gap-2"><span aria-hidden="true" className="mt-2.5 size-1.5 shrink-0 rounded-full bg-emerald-600" />{tip}</li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex gap-1" aria-hidden="true">
            {steps.map((s, i) => (
              <span key={s.title} className={`h-1 flex-1 rounded-full ${i <= index ? 'bg-emerald-600' : 'bg-slate-200 dark:bg-slate-700'}`} />
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-200 p-3 dark:border-slate-800">
          {index === 0 ? (
            <Button type="button" variant="ghost" size="sm" onClick={close}>Skip tour</Button>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => setIndex((i) => Math.max(0, i - 1))}>
              <ArrowLeft className="size-4" aria-hidden="true" /> Back
            </Button>
          )}
          <Button type="button" size="sm" onClick={() => (isLast ? close() : setIndex((i) => i + 1))}>
            {isLast ? (<><CheckCircle2 className="size-4" aria-hidden="true" /> Start using Bulamu</>) : (<>Next <ArrowRight className="size-4" aria-hidden="true" /></>)}
          </Button>
        </div>
      </section>
    </div>
  );
}
