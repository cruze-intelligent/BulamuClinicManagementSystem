'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

/** The build this page is running - the same value each deploy writes to /version.json. */
export const RUNNING_RELEASE = process.env.NEXT_PUBLIC_BUILD_ID ?? '';

/** How often an open page checks for a newer release (also on return to the tab and on reconnecting). */
const CHECK_EVERY_MS = 5 * 60 * 1000;

/** Errors a page throws when it is older than the site it is loading pieces from. */
export const isStaleBuildError = (message: string) =>
  /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(message);

/** True when the site has a newer release than the one this page runs. Never throws. */
export async function newerReleaseAvailable(running: string = RUNNING_RELEASE, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!running) return false;
  try {
    // The query keeps the CDN and the browser from answering with an old copy.
    const res = await fetcher(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    const { release } = (await res.json()) as { release?: string };
    return !!release && release !== running;
  } catch {
    return false;
  }
}

/**
 * Tells staff when Bulamu has been updated while their page was open, so they
 * refresh and get the changes (and avoid a page breaking as it loads pieces of
 * the new version). Work saved on the device is kept through a refresh.
 */
export function UpdateNotice() {
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (stopped || !navigator.onLine || document.visibilityState === 'hidden') return;
      if (await newerReleaseAvailable()) setReady(true);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    // A piece of the page failed to load because the site has moved on: say so at once.
    const onError = (event: ErrorEvent | PromiseRejectionEvent) => {
      const reason = 'reason' in event ? event.reason : event.error ?? event.message;
      const message = reason instanceof Error ? `${reason.name} ${reason.message}` : String(reason ?? '');
      if (isStaleBuildError(message)) {
        setReady(true);
        setDismissed(false);
      }
    };

    // This page opened fine: a later broken page may reload itself again (see app/error.tsx).
    const settled = setTimeout(() => { try { sessionStorage.removeItem('bulamu:reloaded-for-update'); } catch { /* ignore */ } }, 10_000);
    const first = setTimeout(check, 15_000);
    const timer = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', check);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onError);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearTimeout(settled);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', check);
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onError);
    };
  }, []);

  if (!ready || dismissed) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-3 z-[60] flex justify-center px-4">
      <div className="flex w-full max-w-xl flex-wrap items-center gap-3 rounded-lg border border-emerald-300 bg-white px-4 py-3 shadow-lg dark:border-emerald-800 dark:bg-slate-900">
        <RefreshCw className="size-5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
        <p className="min-w-0 flex-1 basis-[14rem] text-sm text-slate-800 dark:text-slate-200">
          <strong className="font-semibold">Bulamu has been updated.</strong> Refresh to get the latest changes - anything saved on this device is kept.
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800"
          >
            Refresh now
          </button>
          <button type="button" onClick={() => setDismissed(true)} aria-label="Later" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
