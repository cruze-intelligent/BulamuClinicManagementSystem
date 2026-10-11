'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/useAuth';
import {
  fetchSubscription, isLapsed, readSubscription, SUBSCRIPTION_CHANGE_EVENT, type SubscriptionSnapshot,
} from '@/lib/subscription-state';

function daysRemaining(dateIso: string): number {
  return Math.max(0, Math.ceil((new Date(dateIso).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

export function TrialBanner() {
  const { user, hasRole } = useAuth();
  const [subscription, setSubscription] = useState<SubscriptionSnapshot | null>(null);

  const signedIn = !!user;
  const role = user?.role;

  useEffect(() => {
    if (!signedIn || role === 'SUPER_ADMIN') return;
    // What this device last knew first (works offline), then the server's answer.
    setSubscription(readSubscription());
    fetchSubscription().catch(() => {});
    const changed = () => setSubscription(readSubscription());
    window.addEventListener(SUBSCRIPTION_CHANGE_EVENT, changed);
    return () => window.removeEventListener(SUBSCRIPTION_CHANGE_EVENT, changed);
  }, [signedIn, role]);

  if (!subscription || role === 'SUPER_ADMIN') return null;

  const isAdmin = hasRole('ADMIN');

  if (isLapsed(subscription)) {
    return (
      <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
        <p className="font-semibold">Your facility&apos;s subscription has ended.</p>
        <p className="mt-0.5">
          You can still view existing records, but new patients, visits and other changes can&apos;t be saved until it is renewed.{' '}
          {isAdmin ? (
            <a href="/billing" className="font-semibold underline">Renew now</a>
          ) : (
            <>Please ask your facility administrator to renew it.</>
          )}
        </p>
      </div>
    );
  }

  if (subscription.status !== 'TRIALING') return null;

  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      {daysRemaining(subscription.trialEndsAt)} day(s) left in your free trial.
      {isAdmin && (<>{' '}<a href="/billing" className="font-semibold underline">Subscribe now</a> - any days left are added on, so paying early costs nothing.</>)}
    </div>
  );
}
