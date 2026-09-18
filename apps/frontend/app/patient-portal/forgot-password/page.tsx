'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useWarmUpBackend } from '@/lib/backend-warmup';

export default function PatientForgotPasswordPage() {
  const [identifier, setIdentifier] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  useWarmUpBackend();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patient-auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });
      if (response.status === 429) {
        setError('Too many attempts. Please wait a few minutes and try again.');
        return;
      }
      setSent(true);
    } catch {
      setError('Unable to reach the Bulamu API. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <Card className="mx-auto max-w-sm rounded-lg border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">Check your email</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          If an account matches, we have emailed a link to reset your password. The link expires in 1 hour, and you
          will be asked to confirm the phone number you gave your facility.
        </p>
        <Link href="/patient-portal/login" className="mt-4 inline-block text-sm text-emerald-700 hover:underline">
          Back to sign in
        </Link>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-sm rounded-lg border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <h1 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">Forgot your password?</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Enter your email address or Patient ID and we will email you a reset link.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <Label htmlFor="identifier">Email or Patient ID</Label>
          <Input id="identifier" required value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? 'Sending...' : 'Send reset link'}
        </Button>
      </form>

      <Link href="/patient-portal/login" className="mt-4 inline-block text-sm text-emerald-700 hover:underline">
        Back to sign in
      </Link>
    </Card>
  );
}
