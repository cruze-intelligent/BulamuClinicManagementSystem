import { useEffect, useState } from 'react';

// The API runs on a hosting tier that puts it to sleep after ~15 minutes
// without traffic, and the first request afterwards can take up to a minute
// while it wakes. Pinging /health as soon as a sign-in or registration page
// opens means the server is usually awake by the time the form is submitted.
export function warmUpBackend() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) return;
  fetch(`${apiUrl}/health`, { cache: 'no-store' }).catch(() => {});
}

export function useWarmUpBackend() {
  useEffect(() => {
    warmUpBackend();
  }, []);
}

// True once a request has been in flight longer than delayMs - used to
// explain a slow first request instead of leaving a button silently spinning.
export function useSlowNotice(active: boolean, delayMs = 4000) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!active) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);

  return slow;
}

export const SLOW_REQUEST_MESSAGE =
  'Connecting to the secure server. If it has been idle this can take up to a minute - please keep this page open.';
