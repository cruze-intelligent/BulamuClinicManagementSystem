'use client';

import { useEffect, useState } from 'react';
import { TriangleAlert, X } from 'lucide-react';
import { dismissRejectedChange, listRejectedChanges, subscribeToLocalChanges, type RejectedChange } from '@/lib/local-first';
import { formatDateTime } from '@/lib/time';

/**
 * Changes made on this device that Bulamu could not accept (and why), so they
 * are entered again rather than lost unnoticed. Each can be dismissed once dealt with.
 */
export function NotSavedChanges() {
  const [changes, setChanges] = useState<RejectedChange[]>([]);
  useEffect(() => {
    const load = () => setChanges(listRejectedChanges());
    load();
    return subscribeToLocalChanges(load);
  }, []);
  if (!changes.length) return null;
  return (
    <section aria-labelledby="not-saved" className="my-6 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
      <h2 id="not-saved" className="flex items-center gap-2 font-semibold text-red-900 dark:text-red-200">
        <TriangleAlert className="size-5" aria-hidden="true" />Not saved - please enter again
      </h2>
      <p className="mt-1 text-sm text-red-900/80 dark:text-red-200/80">
        These were saved on this device but Bulamu could not accept them, so they are not in the facility&apos;s records. Enter each again, then dismiss it here.
      </p>
      <ul className="mt-3 divide-y divide-red-200 dark:divide-red-900">
        {changes.map((c) => (
          <li key={c.mutationId} className="flex flex-wrap items-start gap-2 py-2.5 text-sm">
            <div className="min-w-0 flex-1 basis-[14rem]">
              <p className="font-medium text-slate-900 dark:text-slate-100">{c.what}</p>
              <p className="text-red-800 dark:text-red-300">{c.reason}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{c.savedAt ? `Saved ${formatDateTime(c.savedAt)} - ` : ''}refused {formatDateTime(c.refusedAt)}</p>
            </div>
            <button type="button" onClick={() => dismissRejectedChange(c.mutationId)} className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-900 hover:bg-red-100 dark:border-red-800 dark:bg-slate-900 dark:text-red-200">
              <X className="size-3.5" aria-hidden="true" />Dismiss
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
