'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Download, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import {
  countPendingMutations,
  flushSyncQueue,
  getCurrentClinicId,
  pullSyncUpdates,
  subscribeToLocalChanges,
} from '@/lib/local-first';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export function PwaRuntime({ showWidget = true }: { showWidget?: boolean }) {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  const refreshPending = useCallback(() => {
    countPendingMutations().then(setPending).catch(console.error);
  }, []);

  const syncData = useCallback(async () => {
    setSyncing(true);
    try {
      await flushSyncQueue();
      const clinicId = getCurrentClinicId();
      if (clinicId) await pullSyncUpdates(clinicId);
    } catch (error) {
      console.error('Manual sync failed:', error);
    } finally {
      setSyncing(false);
      refreshPending();
    }
  }, [refreshPending]);

  const handleManualSync = async () => {
    if (!navigator.onLine || syncing) return;
    await syncData();
  };

  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  useEffect(() => {
    setOnline(navigator.onLine);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(console.error);
    }

    const sync = async () => {
      const isOnline = navigator.onLine;
      setOnline(isOnline);
      refreshPending();
      if (!isOnline) return;
      await syncData();
    };

    const beforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    const unsubscribe = subscribeToLocalChanges(refreshPending);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    window.addEventListener('beforeinstallprompt', beforeInstallPrompt);
    refreshPending();
    sync();

    return () => {
      unsubscribe();
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
      window.removeEventListener('beforeinstallprompt', beforeInstallPrompt);
    };
  }, [refreshPending, syncData]);

  const label = !online
    ? 'Offline'
    : syncing
      ? 'Syncing'
      : pending > 0
        ? `${pending} pending`
        : 'Synced';

  // Service worker registration and the install prompt listener above always
  // run so offline caching and installability work from a visitor's first
  // visit - only the floating status widget itself is skipped on pages
  // (marketing, legal, auth) where sync status isn't meaningful and would
  // otherwise sit on top of page content like the footer contact icons.
  if (!showWidget) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-wrap items-center justify-end gap-2">
      {installPrompt && (
        <button
          type="button"
          onClick={handleInstall}
          className="flex min-h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-md transition-colors hover:bg-slate-50"
        >
          <Download className="size-4" aria-hidden="true" />
          Install app
        </button>
      )}
      <button
        type="button"
        onClick={handleManualSync}
        title={online ? 'Click to trigger manual sync' : 'Working offline with local queue'}
        className={`flex min-h-10 items-center gap-2 rounded-md border px-3.5 py-2 text-sm font-medium shadow-md transition-colors ${
          !online
            ? 'border-amber-300 bg-amber-50 text-amber-900'
            : pending > 0
              ? 'border-blue-300 bg-blue-50 text-blue-900'
              : 'border-emerald-300 bg-emerald-50 text-emerald-900'
        }`}
      >
        {!online ? (
          <WifiOff className="size-4 text-amber-600" aria-hidden="true" />
        ) : syncing ? (
          <RefreshCw className="size-4 animate-spin text-blue-600" aria-hidden="true" />
        ) : pending > 0 ? (
          <Wifi className="size-4 text-blue-600" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />
        )}
        <span>{label}</span>
      </button>
    </div>
  );
}
