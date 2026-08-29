"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, RefreshCw, WifiOff } from "lucide-react";
import {
  countPendingMutations,
  flushSyncQueue,
  pullSyncUpdates,
  getCurrentClinicId,
  subscribeToLocalChanges,
} from "@/lib/local-first";

export function PwaRuntime() {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const handleManualSync = async () => {
    if (!navigator.onLine || syncing) return;
    setSyncing(true);
    try {
      await flushSyncQueue();
      const clinicId = getCurrentClinicId();
      if (clinicId) {
        await pullSyncUpdates(clinicId);
      }
    } catch (error) {
      console.error("Manual sync failed:", error);
    } finally {
      setSyncing(false);
      countPendingMutations().then(setPending).catch(console.error);
    }
  };

  useEffect(() => {
    setOnline(navigator.onLine);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(console.error);
    }

    const refreshPending = () => {
      countPendingMutations().then(setPending).catch(console.error);
    };

    const sync = async () => {
      const isOnline = navigator.onLine;
      setOnline(isOnline);
      refreshPending();

      if (!isOnline) return;

      setSyncing(true);
      try {
        await flushSyncQueue();
        const clinicId = getCurrentClinicId();
        if (clinicId) {
          await pullSyncUpdates(clinicId);
        }
      } catch (error) {
        console.error("Auto sync failed:", error);
      } finally {
        setSyncing(false);
        refreshPending();
      }
    };

    const unsubscribe = subscribeToLocalChanges(refreshPending);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    refreshPending();
    sync();

    return () => {
      unsubscribe();
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const label = !online
    ? "Offline Mode"
    : syncing
      ? "Syncing..."
      : pending > 0
        ? `${pending} pending sync`
        : "Local Sync OK";

  return (
    <div
      onClick={handleManualSync}
      title={online ? "Click to trigger manual sync" : "Working offline"}
      className={`fixed bottom-4 right-4 z-50 flex cursor-pointer min-h-10 items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-all shadow-md ${
        !online
          ? "border-amber-300 bg-amber-50 text-amber-900"
          : pending > 0
            ? "border-blue-300 bg-blue-50 text-blue-900"
            : "border-emerald-300 bg-emerald-50 text-emerald-900"
      }`}
    >
      {!online ? (
        <WifiOff className="h-4 w-4 text-amber-600" aria-hidden="true" />
      ) : syncing ? (
        <RefreshCw className="h-4 w-4 animate-spin text-blue-600" aria-hidden="true" />
      ) : (
        <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
      )}
      <span>{label}</span>
    </div>
  );
}
