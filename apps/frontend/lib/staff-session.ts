// The staff sign-in on this device: when it runs out, how it ends, and what
// "Keep me signed in" remembers.

export const REMEMBERED_EMAIL_KEY = 'rememberedEmail';

export type SessionEndReason = 'expired' | 'ended';

/** When the session token runs out (ms since epoch), or null if it can't be read. */
export function tokenExpiry(token: string | null): number | null {
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '='));
    const exp = JSON.parse(json).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

// Kept when signing out: the email the person asked to be remembered, and how
// far each facility's records on this device are synced (the records stay on
// the device, so the next sign-in only downloads what changed instead of the
// whole facility again).
const keepOnSignOut = (key: string) => key === REMEMBERED_EMAIL_KEY || key.startsWith('lastSyncedAt_');

/** The signed-in user, if this device has a session that hasn't run out. */
export function liveSessionUser(): { role?: string } | null {
  try {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    if (!token || !user) return null;
    const expiry = tokenExpiry(token);
    return expiry === null || expiry > Date.now() ? user : null;
  } catch {
    return null;
  }
}

/** Signs this device out. */
export function clearStaffSession() {
  try {
    const kept = Object.keys(localStorage).filter(keepOnSignOut).map((key) => [key, localStorage.getItem(key)!] as const);
    localStorage.clear();
    for (const [key, value] of kept) localStorage.setItem(key, value);
  } catch {
    // Storage blocked - nothing to clear.
  }
}

export function loginPathFor(reason: SessionEndReason) {
  return `/auth/login?session=${reason}`;
}

export function sessionEndMessage(reason: string | null): string | null {
  if (reason === 'expired') return 'Your session has ended. Please sign in again.';
  if (reason === 'ended') return 'You were signed out because your password was changed or your account access changed. Please sign in again.';
  return null;
}

/**
 * Calls onEnded when the server says this device's staff session is over
 * (expired, password changed, account or facility deactivated) - so the person
 * is taken to sign in instead of watching pages fail to load. A 401 for any
 * other reason (a patient's wrong PIN, say) is left to the page.
 */
export function watchForEndedSession(onEnded: () => void): () => void {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  const original = window.fetch;
  if (!apiUrl) return () => {};

  const wrapped: typeof window.fetch = async (input, init) => {
    const response = await original(input, init);
    if (response.status !== 401) return response;
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const token = localStorage.getItem('token');
      const sent = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get('Authorization');
      if (url.startsWith(apiUrl) && token && sent === `Bearer ${token}`) {
        const body = await response.clone().json().catch(() => null);
        if (body?.reason === 'SESSION_ENDED') onEnded();
      }
    } catch {
      // Never let the check itself break a request.
    }
    return response;
  };

  window.fetch = wrapped;
  return () => {
    if (window.fetch === wrapped) window.fetch = original;
  };
}
