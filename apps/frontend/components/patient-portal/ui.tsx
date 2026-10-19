import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Tone } from '@/lib/patient-portal';

const TONES: Record<Tone, string> = {
  good: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-400/20',
  pending: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-400/20',
  owed: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-400/20',
  waiting: 'bg-slate-100 text-slate-700 ring-slate-500/15 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-400/20',
  muted: 'bg-slate-50 text-slate-500 ring-slate-500/10 dark:bg-slate-800/60 dark:text-slate-400 dark:ring-slate-400/10',
};

/** A short status in words, never colour alone. */
export function StateBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>{children}</span>;
}

/** Which facility an item is from - shown only when the patient has more than one. */
export function FacilityTag({ name, show }: { name: string; show: boolean }) {
  if (!show) return null;
  return <span className="text-xs text-slate-500 dark:text-slate-400">at {name}</span>;
}

export function PortalCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900 ${className}`}>{children}</div>;
}

/** What an empty tab means, and what will appear there. */
export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center dark:border-slate-700 dark:bg-slate-900">
      <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <p className="mt-3 font-semibold text-slate-900 dark:text-slate-100">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">{children}</p>
    </div>
  );
}

/** A heading with a line of explanation, for the top of a tab. */
export function TabIntro({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">{title}</h2>
        <p className="mt-0.5 max-w-2xl text-sm text-slate-500 dark:text-slate-400">{children}</p>
      </div>
      {action}
    </div>
  );
}
