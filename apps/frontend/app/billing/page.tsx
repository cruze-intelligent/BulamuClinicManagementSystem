'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Eye, FileDown } from 'lucide-react';
import { useAuth } from '@/lib/useAuth';
import { SubscriptionCalendar } from '@/components/subscription-calendar';
import { ContactIcons } from '@/components/contact-icons';
import { FacilityDetailsModal } from '@/components/facility-details-modal';

type Subscription = {
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
  plan: 'STANDARD' | 'CUSTOM';
  planNotes: string | null;
  trialEndsAt: string;
  currentPeriodEnd: string | null;
  amount: number;
  currency: string;
  lastPaymentAt: string | null;
  createdAt: string;
};

type Payment = {
  id: string;
  amount: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
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
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(false);
  const [downloadingReceiptId, setDownloadingReceiptId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showFacilityDetails, setShowFacilityDetails] = useState(false);

  const fetchStatus = async () => {
    const token = localStorage.getItem('token');
    try {
      const [statusRes, paymentsRes] = await Promise.all([
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/billing/status`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/billing/payments`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      const statusData = await statusRes.json();
      if (statusData.success) setSubscription(statusData.subscription);
      const paymentsData = await paymentsRes.json();
      if (paymentsData.success) setPayments(paymentsData.payments);
    } catch {
      setError('Could not reach the Bulamu API');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const downloadReceipt = async (paymentId: string) => {
    const token = localStorage.getItem('token');
    setDownloadingReceiptId(paymentId);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/billing/receipts/${paymentId}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to generate receipt');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `receipt-${paymentId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert('Error downloading receipt');
    } finally {
      setDownloadingReceiptId(null);
    }
  };

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

  const facilityCode = (() => {
    if (typeof window === 'undefined') return null;
    try {
      return JSON.parse(localStorage.getItem('user') || '{}')?.clinic?.facilityCode || null;
    } catch {
      return null;
    }
  })();

  const clinicId = (() => {
    if (typeof window === 'undefined') return null;
    try {
      return JSON.parse(localStorage.getItem('user') || '{}')?.clinicId || null;
    } catch {
      return null;
    }
  })();

  if (!hasRole('ADMIN')) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-8">
        <Card className="mx-auto max-w-lg p-6 text-center text-slate-600 dark:text-slate-400">
          Only your facility administrator can manage billing.
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-8">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-2 text-3xl font-bold text-slate-800 dark:text-slate-200">Billing & Subscription</h1>
        <p className="mb-1 text-sm text-slate-500 dark:text-slate-400">Manage your facility&apos;s Bulamu subscription.</p>
        <div className="mb-6 flex items-center justify-between gap-3">
          {facilityCode ? (
            <p className="font-mono text-xs text-slate-400 dark:text-slate-500">Facility ID: {facilityCode}</p>
          ) : <span />}
          {clinicId && (
            <Button size="sm" variant="outline" onClick={() => setShowFacilityDetails(true)}>
              <Eye className="size-4" aria-hidden="true" />
              View facility details
            </Button>
          )}
        </div>

        <Card className="p-6">
          {loading ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Loading...</p>
          ) : subscription ? (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Status</p>
                  <p className="text-xl font-semibold text-slate-800 dark:text-slate-200">
                    {STATUS_LABEL[subscription.status]}
                    {subscription.plan === 'CUSTOM' && (
                      <span className="ml-2 rounded-full bg-violet-50 px-2 py-0.5 align-middle text-xs font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-400">
                        Custom plan
                      </span>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-slate-500 dark:text-slate-400">Monthly fee</p>
                  <p className="text-xl font-semibold text-slate-800 dark:text-slate-200">
                    {subscription.amount.toLocaleString()} {subscription.currency}
                  </p>
                </div>
              </div>

              {subscription.plan === 'CUSTOM' && subscription.planNotes && (
                <div className="mt-4 rounded-lg border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900 dark:border-violet-900 dark:bg-violet-950/50 dark:text-violet-300">
                  <p className="font-medium">Your custom plan covers:</p>
                  <p className="mt-1">{subscription.planNotes}</p>
                </div>
              )}

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
            <p className="text-sm text-slate-500 dark:text-slate-400">No subscription found for your facility.</p>
          )}
        </Card>

        {subscription && (
          <Card className="mt-6 p-6">
            <h2 className="mb-1 text-lg font-semibold text-slate-800 dark:text-slate-200">Subscription calendar</h2>
            <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
              Highlighted days are covered by your {subscription.status === 'TRIALING' ? 'free trial' : 'subscription'}.
            </p>
            <SubscriptionCalendar
              coveredStart={new Date(subscription.createdAt)}
              coveredEnd={new Date(
                subscription.status === 'TRIALING'
                  ? subscription.trialEndsAt
                  : subscription.currentPeriodEnd || subscription.trialEndsAt
              )}
              label={subscription.status === 'TRIALING' ? 'your free trial' : 'your active subscription'}
            />
          </Card>
        )}

        {subscription && subscription.plan === 'STANDARD' && (
          <Card className="mt-6 p-6">
            <h2 className="mb-1 text-lg font-semibold text-slate-800 dark:text-slate-200">Need something different?</h2>
            <p className="mb-4 text-sm leading-6 text-slate-500 dark:text-slate-400">
              If your facility needs higher patient volume, multi-facility bundling, a custom integration, or
              features outside the standard plan, reach out and we&apos;ll set up a custom plan for you.
            </p>
            <ContactIcons />
          </Card>
        )}

        {payments.length > 0 && (
          <Card className="mt-6 p-6">
            <h2 className="mb-4 text-lg font-semibold text-slate-800 dark:text-slate-200">Payment History</h2>
            <div className="space-y-2">
              {payments.map((payment) => (
                <div
                  key={payment.id}
                  className="flex items-center justify-between rounded-md bg-slate-50 dark:bg-slate-800 p-3 text-sm"
                >
                  <div>
                    <p className="font-medium text-slate-800 dark:text-slate-200">
                      {payment.amount === 0
                        ? 'Free trial (2 weeks)'
                        : `${payment.amount.toLocaleString()} ${payment.currency}`}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {payment.amount === 0 ? 'Started ' : ''}
                      {new Date(payment.amount === 0 ? payment.createdAt : payment.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={downloadingReceiptId === payment.id}
                    onClick={() => downloadReceipt(payment.id)}
                  >
                    <FileDown className="size-4" aria-hidden="true" />
                    {downloadingReceiptId === payment.id ? 'Preparing...' : 'Receipt'}
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {showFacilityDetails && clinicId && (
        <FacilityDetailsModal clinicId={clinicId} onClose={() => setShowFacilityDetails(false)} />
      )}
    </div>
  );
}
