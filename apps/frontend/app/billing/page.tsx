'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/useAuth';

type Subscription = {
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
  trialEndsAt: string;
  currentPeriodEnd: string | null;
  amount: number;
  currency: string;
  lastPaymentAt: string | null;
};

const STATUS_LABEL: Record<Subscription['status'], string> = {
  TRIALING: 'Free trial',
  ACTIVE: 'Active',
  PAST_DUE: 'Past due',
  CANCELLED: 'Cancelled',
};

function daysRemaining(dateIso: string): number {
  return Math.max(0, Math.ceil((new Date(dateIso).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

export default function BillingPage() {
  const { hasRole } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(false);
  const [error, setError] = useState('');

  const fetchStatus = async () => {
    const token = localStorage.getItem('token');
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/billing/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success) setSubscription(data.subscription);
    } catch {
      setError('Could not reach the Bulamu API');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleSubscribe = async () => {
    setSubscribing(true);
    setError('');
    const token = localStorage.getItem('token');
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/billing/subscribe`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success && data.redirectUrl) {
        window.location.href = data.redirectUrl;
      } else {
        setError(data.error || 'Could not start the payment');
        setSubscribing(false);
      }
    } catch {
      setError('Could not reach the Bulamu API');
      setSubscribing(false);
    }
  };

  if (!hasRole('ADMIN')) {
    return (
      <div className="min-h-screen bg-slate-50 p-8">
        <Card className="mx-auto max-w-lg p-6 text-center text-slate-600">
          Only your facility administrator can manage billing.
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-2 text-3xl font-bold text-slate-800">Billing & Subscription</h1>
        <p className="mb-6 text-sm text-slate-500">Manage your facility&apos;s Bulamu subscription.</p>

        <Card className="p-6">
          {loading ? (
            <p className="text-sm text-slate-500">Loading...</p>
          ) : subscription ? (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Status</p>
                  <p className="text-xl font-semibold text-slate-800">{STATUS_LABEL[subscription.status]}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-slate-500">Monthly fee</p>
                  <p className="text-xl font-semibold text-slate-800">
                    {subscription.amount.toLocaleString()} {subscription.currency}
                  </p>
                </div>
              </div>

              {subscription.status === 'TRIALING' && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  {daysRemaining(subscription.trialEndsAt)} day(s) left in your free trial. Subscribe now to keep
                  full access after it ends.
                </div>
              )}
              {subscription.status === 'PAST_DUE' && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                  Your trial or subscription has lapsed. New records can&apos;t be saved until payment is completed.
                </div>
              )}
              {subscription.status === 'ACTIVE' && subscription.currentPeriodEnd && (
                <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                  Active until {new Date(subscription.currentPeriodEnd).toLocaleDateString()}.
                </div>
              )}

              {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

              {subscription.status !== 'ACTIVE' && (
                <Button className="mt-6 w-full" onClick={handleSubscribe} disabled={subscribing}>
                  {subscribing ? 'Redirecting to Pesapal...' : `Subscribe - ${subscription.amount.toLocaleString()} ${subscription.currency}/mo`}
                </Button>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-500">No subscription found for your facility.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
