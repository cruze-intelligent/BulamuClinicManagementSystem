'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { fetchSubscription } from '@/lib/subscription-state';

export default function BillingCallbackPage() {
  const [status, setStatus] = useState<'checking' | 'active' | 'pending' | 'failed'>('checking');

  useEffect(() => {
    let attempts = 0;

    // Pesapal sends the admin back with the order's tracking id: ask about
    // that exact order (an early renewal is already Active, so the
    // subscription status alone can't say whether this payment went through).
    const orderTrackingId = new URLSearchParams(window.location.search).get('OrderTrackingId');

    const poll = async () => {
      attempts += 1;
      try {
        if (orderTrackingId) {
          const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/billing/confirm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
            body: JSON.stringify({ orderTrackingId }),
          });
          const data = await res.json().catch(() => ({}));
          if (data.outcome === 'activated' || data.outcome === 'already-applied') {
            // Also tells the rest of the app - saving reopens and anything
            // waiting on this device is sent.
            await fetchSubscription().catch(() => null);
            setStatus('active');
            return;
          }
          if (data.outcome === 'failed' || data.outcome === 'amount-mismatch') {
            setStatus('failed');
            return;
          }
        } else {
          const subscription = await fetchSubscription();
          if (subscription?.status === 'ACTIVE') {
            setStatus('active');
            return;
          }
        }
      } catch {
        // keep polling
      }
      if (attempts < 5) {
        setTimeout(poll, 3000);
      } else {
        setStatus('pending');
      }
    };

    poll();
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950 p-8">
      <Card className="max-w-md p-8 text-center">
        {status === 'checking' && (
          <>
            <Loader2 className="mx-auto size-10 animate-spin text-slate-400 dark:text-slate-500" aria-hidden="true" />
            <h1 className="mt-4 text-xl font-semibold text-slate-800 dark:text-slate-200">Confirming your payment...</h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">This usually takes a few seconds.</p>
          </>
        )}
        {status === 'active' && (
          <>
            <CheckCircle2 className="mx-auto size-10 text-emerald-600" aria-hidden="true" />
            <h1 className="mt-4 text-xl font-semibold text-slate-800 dark:text-slate-200">Subscription active</h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Thank you - your facility subscription is now active.</p>
            <Button className="mt-6 w-full" onClick={() => (window.location.href = '/dashboard')}>
              Go to Dashboard
            </Button>
          </>
        )}
        {status === 'failed' && (
          <>
            <XCircle className="mx-auto size-10 text-red-600" aria-hidden="true" />
            <h1 className="mt-4 text-xl font-semibold text-slate-800 dark:text-slate-200">Payment not completed</h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Pesapal did not confirm this payment, so nothing was charged to your subscription. You can try again from the Billing page.
            </p>
            <Button className="mt-6 w-full" onClick={() => (window.location.href = '/billing')}>
              Go to Billing
            </Button>
          </>
        )}
        {status === 'pending' && (
          <>
            <Clock className="mx-auto size-10 text-amber-500" aria-hidden="true" />
            <h1 className="mt-4 text-xl font-semibold text-slate-800 dark:text-slate-200">Payment still processing</h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              We haven&apos;t received confirmation yet. If you completed payment, this can take a minute - check the
              billing page shortly.
            </p>
            <Button className="mt-6 w-full" onClick={() => (window.location.href = '/billing')}>
              Go to Billing
            </Button>
          </>
        )}
      </Card>
    </main>
  );
}
