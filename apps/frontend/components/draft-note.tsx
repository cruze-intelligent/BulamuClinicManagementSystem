'use client';

import { draftTime } from '@/lib/drafts';

/**
 * One quiet line under a form: whether what was typed is kept as a draft on
 * this device, and - when a draft was brought back - from when, with a way to
 * start again instead.
 */
export function DraftNote({ savedAt, restoredAt, onDiscard, className = '' }: {
  savedAt: string | null; restoredAt: string | null; onDiscard: () => void; className?: string;
}) {
  if (!savedAt && !restoredAt) return null;
  return (
    <p role="status" className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400 ${className}`}>
      {restoredAt ? (
        <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
          Your unsaved draft from {draftTime(restoredAt)} is back.
        </span>
      ) : null}
      {savedAt && <span>Draft kept on this device at {draftTime(savedAt)} - it stays if the page is refreshed.</span>}
      <button type="button" className="font-medium text-rose-700 underline underline-offset-2 hover:text-rose-800 dark:text-rose-400" onClick={() => { if (confirm('Throw this draft away? What was typed is cleared.')) onDiscard(); }}>
        Discard draft
      </button>
    </p>
  );
}
