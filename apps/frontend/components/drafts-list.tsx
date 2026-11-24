'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FilePen } from 'lucide-react';
import { clearDraft, draftTime, listDrafts, type DraftSummary } from '@/lib/drafts';

/**
 * The forms this person started on this device and has not saved yet - a visit
 * saved as a draft to finish later, results half entered - each with a way back
 * to it. Shows nothing when there are none.
 */
export function DraftsList({ form, title = 'Unfinished drafts', className = '' }: { form?: string; title?: string; className?: string }) {
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);

  useEffect(() => {
    const load = () => setDrafts(listDrafts(form).filter((d) => d.path));
    load();
    // Another tab saving or finishing a draft.
    window.addEventListener('storage', load);
    return () => window.removeEventListener('storage', load);
  }, [form]);

  if (drafts.length === 0) return null;
  return (
    <section aria-label={title} className={`rounded-lg border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900 dark:bg-amber-950/30 ${className}`}>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
        <FilePen className="size-4" aria-hidden="true" />{title}
      </h2>
      <p className="mt-0.5 text-xs text-amber-900/80 dark:text-amber-200/80">Kept on this device, for you only. Nothing in them is saved to the patient&apos;s record until you finish them.</p>
      <ul className="mt-2 space-y-1.5">
        {drafts.map((d) => (
          <li key={`${d.form}:${d.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <Link href={d.path!} className="font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-900 dark:text-emerald-300">{d.label}</Link>
            <span className="text-xs text-slate-500 dark:text-slate-400">kept {draftTime(d.savedAt)}</span>
            <button
              type="button"
              className="text-xs text-rose-700 hover:underline dark:text-rose-400"
              onClick={() => {
                if (!confirm(`Throw away the draft "${d.label}"?`)) return;
                clearDraft(d.form, d.id);
                setDrafts((list) => list.filter((x) => x !== d));
              }}
            >
              Discard
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
