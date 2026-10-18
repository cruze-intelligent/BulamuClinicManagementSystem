'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, Download, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import {
  countPendingMutations,
  flushSyncQueue,
  getCurrentClinicId,
  pullSyncUpdates,
  subscribeToLocalChanges,
} from '@/lib/local-first';
import { isLapsed, readSubscription, SUBSCRIPTION_CHANGE_EVENT } from '@/lib/subscription-state';
import { getInstallPrompt, INSTALL_PROMPT_EVENT, promptInstall, setInstallPrompt, type BeforeInstallPromptEvent } from '@/lib/install-prompt';


// The platform administrator records nothing on the device, so there is
// nothing to send or download - syncing only slowed their pages down.
function isPlatformAdmin() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}').role === 'SUPER_ADMIN';
  } catch {
    return false;
  }
}

export function PwaRuntime({ showWidget = true }: { showWidget?: boolean }) {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [installPrompt, setInstallPromptState] = useState<BeforeInstallPromptEvent | null>(null);
  // The facility's subscription has ended: queued saves can't go up until it renews.
  const [lapsed, setLapsed] = useState(false);

  const refreshPending = useCallback(() => {
    countPendingMutations().then(setPending).catch(console.error);
  }, []);

  const syncData = useCallback(async () => {
    if (isPlatformAdmin()) return;
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
    await promptInstall();
  };

  useEffect(() => {
    setOnline(navigator.onLine);

    if ('serviceWorker' in navigator) {
      // A new address per build, and no HTTP caching, so each deploy's worker
      // reaches devices even though the CDN caches scripts for a week.
      navigator.serviceWorker
        .register(`/sw.js?v=${process.env.NEXT_PUBLIC_BUILD_ID}`, { updateViaCache: 'none' })
        .catch(console.error);
    }

    const sync = async () => {
      const isOnline = navigator.onLine;
      setOnline(isOnline);
      refreshPending();
      if (!isOnline) return;
      await syncData();
    };

    // Kept in lib/install-prompt so the install guide on the Help page can use it too.
    const beforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const installPromptChanged = () => setInstallPromptState(getInstallPrompt());
    installPromptChanged();
    window.addEventListener(INSTALL_PROMPT_EVENT, installPromptChanged);

    // Found to have ended - say so; renewed - send anything that was waiting.
    let wasLapsed = isLapsed(readSubscription());
    setLapsed(wasLapsed);
    const subscriptionChanged = () => {
      const nowLapsed = isLapsed(readSubscription());
      setLapsed(nowLapsed);
      if (wasLapsed && !nowLapsed && navigator.onLine) void syncData();
      wasLapsed = nowLapsed;
    };

    const unsubscribe = subscribeToLocalChanges(refreshPending);
    window.addEventListener(SUBSCRIPTION_CHANGE_EVENT, subscriptionChanged);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    window.addEventListener('beforeinstallprompt', beforeInstallPrompt);
    refreshPending();
    sync();

    return () => {
      unsubscribe();
      window.removeEventListener(SUBSCRIPTION_CHANGE_EVENT, subscriptionChanged);
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
      window.removeEventListener('beforeinstallprompt', beforeInstallPrompt);
      window.removeEventListener(INSTALL_PROMPT_EVENT, installPromptChanged);
    };
  }, [refreshPending, syncData]);

  const label = !online
    ? 'Offline'
    : syncing
      ? 'Syncing'
      : pending > 0
        ? lapsed ? `${pending} not sent` : `${pending} pending`
        : 'Synced';
  const blockedTitle = `${pending} saved change${pending === 1 ? '' : 's'} on this device can't be sent because your facility's subscription has ended. They are kept here and sent as soon as it is renewed - don't clear this browser's data.`;

  // Service worker registration and the install prompt listener above always
  // run so offline caching and installability work from a visitor's first
  // visit - only the floating status widget itself is skipped on pages
  // (marketing, legal, auth) where sync status isn't meaningful and would
  // otherwise sit on top of page content like the footer contact icons.
  if (!showWidget) return null;
  const hideSyncStatus = isPlatformAdmin();
  if (hideSyncStatus && !installPrompt) return null;

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
      {!hideSyncStatus && (<button
        type="button"
        onClick={handleManualSync}
        title={lapsed && pending > 0 ? blockedTitle : online ? 'Send waiting changes now' : 'Working offline - changes are saved on this device'}
        className={`flex min-h-10 items-center gap-2 rounded-md border px-3.5 py-2 text-sm font-medium shadow-md transition-colors ${
          !online
            ? 'border-amber-300 bg-amber-50 text-amber-900'
            : lapsed && pending > 0
              ? 'border-red-300 bg-red-50 text-red-900'
            : pending > 0
              ? 'border-blue-300 bg-blue-50 text-blue-900'
              : 'border-emerald-300 bg-emerald-50 text-emerald-900'
        }`}
      >
        {!online ? (
          <WifiOff className="size-4 text-amber-600" aria-hidden="true" />
        ) : lapsed && pending > 0 ? (
          <CircleAlert className="size-4 text-red-600" aria-hidden="true" />
        ) : syncing ? (
          <RefreshCw className="size-4 animate-spin text-blue-600" aria-hidden="true" />
        ) : pending > 0 ? (
          <Wifi className="size-4 text-blue-600" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />
        )}
        <span>{label}</span>
      </button>)}
    </div>
  );
}
