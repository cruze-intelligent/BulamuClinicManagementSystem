'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { FlaskConical, ScanLine, X } from 'lucide-react';
import { NOTIFICATIONS_CHANGED_EVENT } from '@/lib/useUnreadNotifications';

type Alert = { id: string; type: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string };

/** What pops up: results coming back to whoever asked, and new requests reaching the lab and imaging. */
export const POPPED_TYPES = new Set(['LAB_RESULT_AVAILABLE', 'LAB_RESULT_READY', 'IMAGING_REPORTED', 'LAB_TEST_ORDERED', 'IMAGING_REQUESTED']);
const CHECK_EVERY_MS = 45_000;
/** Older than this when the page opens, it is left to the notifications list. */
const FRESH_MS = 15 * 60 * 1000;
const SHOWN_KEY = 'bulamu:popped-notifications';

const readShown = (): string[] => {
  try {
    return JSON.parse(sessionStorage.getItem(SHOWN_KEY) || '[]');
  } catch {
    return [];
  }
};

/** The alerts to pop up now: unread, of a kind that pops, recent, and not popped before. */
export function alertsToPop(list: Alert[], shown: string[], now = Date.now()): Alert[] {
  return list.filter((n) => !n.readAt && POPPED_TYPES.has(n.type) && !shown.includes(n.id) && now - new Date(n.createdAt).getTime() < FRESH_MS);
}

/**
 * Pops up a result as it comes back (with a link to the visit waiting on it),
 * and a new request as it reaches the lab or imaging - so nobody has to keep
 * checking the notifications page.
 */
export function ResultAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const busy = useRef(false);

  const check = useCallback(async () => {
    if (busy.current || !navigator.onLine || document.visibilityState !== 'visible') return;
    const token = localStorage.getItem('token');
    if (!token) return;
    busy.current = true;
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/notifications?limit=15`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const data = await res.json();
      const fresh = alertsToPop(data.notifications ?? [], readShown());
      if (!fresh.length) return;
      try {
        sessionStorage.setItem(SHOWN_KEY, JSON.stringify([...readShown(), ...fresh.map((n) => n.id)].slice(-100)));
      } catch {
        // Not remembered: at worst it pops up once more.
      }
      setAlerts((current) => [...fresh, ...current].slice(0, 3));
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
    } catch {
      // A missed check is harmless - the next one finds it.
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    void check();
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    window.addEventListener('focus', check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, [check]);

  const close = (alert: Alert, markRead: boolean) => {
    setAlerts((current) => current.filter((a) => a.id !== alert.id));
    if (!markRead) return;
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/notifications/${alert.id}/read`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then(() => window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT)))
      .catch(() => undefined);
  };

  if (!alerts.length) return null;
  return (
    <div className="fixed right-4 top-16 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 lg:top-4" role="region" aria-label="New results and requests">
      {alerts.map((a) => {
        const Icon = a.type.startsWith('IMAGING') ? ScanLine : FlaskConical;
        return (
          <div key={a.id} role="status" className="rounded-lg border border-emerald-200 bg-white p-3 shadow-lg dark:border-emerald-900 dark:bg-slate-900">
            <div className="flex items-start gap-2">
              <Icon className="mt-0.5 size-5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{a.title}</p>
                <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{a.body}</p>
                {a.link && (
                  <Link href={a.link} onClick={() => close(a, true)} className="mt-2 inline-flex rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800">
                    Open
                  </Link>
                )}
              </div>
              <button type="button" onClick={() => close(a, false)} aria-label="Dismiss" className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
