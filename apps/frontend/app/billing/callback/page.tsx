'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, Clock } from 'lucide-react';

export default function BillingCallbackPage() {
  const [status, setStatus] = useState<'checking' | 'active' | 'pending'>('checking');

  useEffect(() => {
    let attempts = 0;
    const token = localStorage.getItem('token');

    const poll = async () => {
      attempts += 1;
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/billing/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json();
        if (data.success && data.subscription?.status === 'ACTIVE') {
          setStatus('active');
          return;
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
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-8">
      <Card className="max-w-md p-8 text-center">
        {status === 'checking' && (
          <>
            <Loader2 className="mx-auto size-10 animate-spin text-slate-400" aria-hidden="true" />
            <h1 className="mt-4 text-xl font-semibold text-slate-800">Confirming your payment...</h1>
            <p className="mt-2 text-sm text-slate-500">This usually takes a few seconds.</p>
          </>
        )}
        {status === 'active' && (
          <>
            <CheckCircle2 className="mx-auto size-10 text-emerald-600" aria-hidden="true" />
            <h1 className="mt-4 text-xl font-semibold text-slate-800">Subscription active</h1>
            <p className="mt-2 text-sm text-slate-500">Thank you - your facility subscription is now active.</p>
            <Button className="mt-6 w-full" onClick={() => (window.location.href = '/dashboard')}>
              Go to Dashboard
            </Button>
          </>
        )}
        {status === 'pending' && (
          <>
            <Clock className="mx-auto size-10 text-amber-500" aria-hidden="true" />
            <h1 className="mt-4 text-xl font-semibold text-slate-800">Payment still processing</h1>
            <p className="mt-2 text-sm text-slate-500">
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
