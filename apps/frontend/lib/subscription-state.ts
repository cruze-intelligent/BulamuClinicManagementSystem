// The facility's subscription as this device last saw it, so a save can be
// refused with a clear message when the trial or paid period has ended - even
// offline - instead of being queued on the device where the server will refuse
// it and nobody else can see it.

export type SubscriptionSnapshot = {
  clinicId: string;
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
  trialEndsAt: string;
  currentPeriodEnd?: string | null;
};

export const SUBSCRIPTION_ENDED_MESSAGE =
  "Your facility's subscription has ended, so this can't be saved. Existing records can still be viewed. An administrator can renew it from the Billing page.";

export const SUBSCRIPTION_CHANGE_EVENT = 'bulamu-subscription-change';

const STORAGE_KEY = 'subscriptionSnapshot';

export class SubscriptionRequiredError extends Error {
  constructor() {
    super(SUBSCRIPTION_ENDED_MESSAGE);
    this.name = 'SubscriptionRequiredError';
  }
}

/** Whether saving is closed - the same rule the server applies. */
export function isLapsed(snapshot: SubscriptionSnapshot | null, now: number = Date.now()): boolean {
  if (!snapshot) return false;
  if (snapshot.status === 'PAST_DUE' || snapshot.status === 'CANCELLED') return true;
  if (snapshot.status === 'TRIALING') return new Date(snapshot.trialEndsAt).getTime() < now;
  if (snapshot.status === 'ACTIVE' && snapshot.currentPeriodEnd) return new Date(snapshot.currentPeriodEnd).getTime() < now;
  return false;
}

function currentUser(): { clinicId?: string; role?: string } {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}');
  } catch {
    return {};
  }
}

/** The snapshot for whoever is signed in on this device (none for the platform administrator). */
export function readSubscription(): SubscriptionSnapshot | null {
  if (typeof window === 'undefined') return null;
  const user = currentUser();
  if (!user.clinicId || user.role === 'SUPER_ADMIN') return null;
  try {
    const snapshot = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as SubscriptionSnapshot | null;
    return snapshot && snapshot.clinicId === user.clinicId ? snapshot : null;
  } catch {
    return null;
  }
}

export function rememberSubscription(snapshot: SubscriptionSnapshot) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Storage full or blocked - the server still enforces it.
  }
  window.dispatchEvent(new Event(SUBSCRIPTION_CHANGE_EVENT));
}

/** The server refused a save (402) - remember it so the banner and sync badge say why. */
export function markSubscriptionLapsed() {
  const snapshot = readSubscription();
  const clinicId = currentUser().clinicId;
  if (!clinicId) return;
  rememberSubscription({ trialEndsAt: new Date(0).toISOString(), ...snapshot, clinicId, status: 'PAST_DUE' });
}

export async function fetchSubscription(): Promise<SubscriptionSnapshot | null> {
  const token = localStorage.getItem('token');
  if (!token) return null;
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/billing/status`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok || !data.success || !data.subscription) return null;
  const snapshot: SubscriptionSnapshot = {
    clinicId: data.subscription.clinicId,
    status: data.subscription.status,
    trialEndsAt: data.subscription.trialEndsAt,
    currentPeriodEnd: data.subscription.currentPeriodEnd,
  };
  rememberSubscription(snapshot);
  return snapshot;
}

/**
 * Throws SubscriptionRequiredError when saving is closed. If this device thinks
 * so but is online, it asks the server first - the facility may have just paid.
 */
export async function assertCanSave(): Promise<void> {
  if (!isLapsed(readSubscription())) return;
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    try {
      const fresh = await fetchSubscription();
      if (fresh && !isLapsed(fresh)) return;
    } catch {
      // Unreachable - go by what this device last knew.
    }
  }
  throw new SubscriptionRequiredError();
}
