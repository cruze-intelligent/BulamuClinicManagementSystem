'use client';

import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { isStaleBuildError } from '@/components/update-notice';

const RELOADED_KEY = 'bulamu:reloaded-for-update';

/**
 * A page that failed to open. Most often it is older than the site after an
 * update and could not load a piece of the new version: then it reloads once
 * by itself. Otherwise it offers a refresh instead of a blank screen.
 */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = isStaleBuildError(`${error?.name ?? ''} ${error?.message ?? ''}`);

  useEffect(() => {
    console.error(error);
    if (!stale) return;
    try {
      if (sessionStorage.getItem(RELOADED_KEY)) return;
      sessionStorage.setItem(RELOADED_KEY, '1');
    } catch {
      return;
    }
    window.location.reload();
  }, [error, stale]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{stale ? 'Bulamu has been updated' : 'This page could not open'}</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          {stale
            ? 'Refresh to load the latest version. Anything saved on this device is kept.'
            : 'Something went wrong while opening it. Refreshing usually fixes this - anything saved on this device is kept.'}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              try { sessionStorage.removeItem(RELOADED_KEY); } catch { /* ignore */ }
              window.location.reload();
            }}
            className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
          >
            <RefreshCw className="size-4" aria-hidden="true" />Refresh
          </button>
          {!stale && (
            <button type="button" onClick={reset} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
