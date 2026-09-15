'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } finally {
      // Always show the same confirmation regardless of outcome, so this
      // endpoint can't be used to check which emails have an account.
      setSubmitted(true);
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-white flex items-center justify-center">
      <Card className="w-full max-w-md rounded-lg border-slate-800 bg-white p-6 text-slate-950 shadow-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="mt-1 text-sm text-slate-500">
          Enter your account email. If it matches a facility account, we'll send a reset link.
        </p>

        {submitted ? (
          <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            If an account exists for that email, a reset link has been sent. Ask your facility admin if you don't
            receive it and can't access your email.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Sending...' : 'Send reset link'}
            </Button>
          </form>
        )}

        <div className="mt-6 text-center">
          <Link href="/auth/login" className="text-sm text-emerald-700 hover:underline">
            Back to sign in
          </Link>
        </div>
      </Card>
    </main>
  );
}
