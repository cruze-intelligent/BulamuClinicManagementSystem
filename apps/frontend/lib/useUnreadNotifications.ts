import { useCallback, useEffect, useState } from 'react';

// Fired by the notifications page after the user marks things read, so the
// sidebar / header badge updates immediately instead of at the next poll.
export const NOTIFICATIONS_CHANGED_EVENT = 'bulamu:notifications-changed';

const POLL_INTERVAL_MS = 2 * 60 * 1000;

// Unread-notification count for a badge. `endpoint` is the cheap count route
// ('/notifications/unread-count' for staff, '/patient-portal/notifications/
// unread-count' for patients) and `tokenKey` the localStorage key holding that
// session's token. Polls gently and only while the tab is visible and online.
export function useUnreadNotifications(endpoint: string, tokenKey: string, enabled = true): number {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!enabled || typeof navigator === 'undefined' || !navigator.onLine || document.visibilityState === 'hidden') return;
    const token = localStorage.getItem(tokenKey);
    if (!token) return;
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) setCount(data.count);
    } catch {
      // A missed poll is harmless - the badge just stays as it was.
    }
  }, [endpoint, tokenKey, enabled]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    window.addEventListener('focus', refresh);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
    };
  }, [refresh, enabled]);

  return count;
}
