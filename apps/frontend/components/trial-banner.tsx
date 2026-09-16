'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/useAuth';

type Subscription = {
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
  trialEndsAt: string;
};

function daysRemaining(dateIso: string): number {
  return Math.max(0, Math.ceil((new Date(dateIso).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

export function TrialBanner() {
  const { user, hasRole } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);

  useEffect(() => {
    if (!user || user.role === 'SUPER_ADMIN') return;
    const token = localStorage.getItem('token');
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/billing/status`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json())
      .then((data) => { if (data.success) setSubscription(data.subscription); })
      .catch(() => {});
  }, [user]);

  if (!subscription || subscription.status === 'ACTIVE' || subscription.status === 'CANCELLED') return null;

  const isAdmin = hasRole('ADMIN');

  if (subscription.status === 'PAST_DUE') {
    return (
      <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {isAdmin ? (
          <>Your facility subscription is past due - new records can&apos;t be saved. <a href="/billing" className="font-semibold underline">Subscribe now</a>.</>
        ) : (
          <>Your facility subscription is past due. Ask your administrator to renew it.</>
        )}
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      {daysRemaining(subscription.trialEndsAt)} day(s) left in your free trial.
      {isAdmin && (<>{' '}<a href="/billing" className="font-semibold underline">Subscribe now</a>.</>)}
    </div>
  );
}
