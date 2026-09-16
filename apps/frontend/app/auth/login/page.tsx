'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function loginErrorMessage(reason: string | undefined, rejectionReason: string | undefined): string | null {
  switch (reason) {
    case 'PENDING_APPROVAL':
      return "Your facility registration is still pending approval. We'll notify you once it's reviewed.";
    case 'REJECTED':
      return rejectionReason
        ? `Your facility registration was not approved: ${rejectionReason}`
        : 'Your facility registration was not approved. Contact us for details.';
    case 'SUSPENDED':
      return 'Your facility account is currently suspended. Contact your administrator or Bulamu support.';
    case 'ACCOUNT_DEACTIVATED':
      return 'Your account has been deactivated. Contact your facility administrator.';
    default:
      return null;
  }
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (data.success) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        router.push(data.user.role === 'SUPER_ADMIN' ? '/super-admin' : '/dashboard');
      } else {
        alert(loginErrorMessage(data.reason, data.rejectionReason) || 'Invalid email or password');
      }
    } catch {
      alert('Unable to reach the Bulamu API. Confirm the backend is running and NEXT_PUBLIC_API_URL is configured.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-white">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl items-center gap-8 lg:grid-cols-[1fr_440px]">
        <section>
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-md bg-emerald-500 text-slate-950 dark:text-slate-50">
              <ShieldCheck className="size-6" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Bulamu</h1>
              <p className="text-sm uppercase tracking-wide text-emerald-300">Medical Facility OS</p>
            </div>
          </div>
          <h2 className="mt-10 max-w-2xl text-5xl font-semibold tracking-tight">
            Secure access for authorized medical facility teams.
          </h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-slate-300">
            Sign in to manage facility operations, patient records, care workflows, stock, billing, reports,
            interoperability exports, and offline synchronization.
          </p>
          <div className="mt-8 grid max-w-2xl gap-3 sm:grid-cols-3">
            {['Role based', 'PWA enabled', 'FHIR ready'].map((item) => (
              <div key={item} className="rounded-md border border-white/10 bg-white dark:bg-slate-900/5 px-4 py-3 text-sm text-slate-200">
                {item}
              </div>
            ))}
          </div>
          <p className="mt-10 text-sm text-slate-400 dark:text-slate-500">A product of Cruze Intelligent Systems (U) Ltd.</p>
        </section>

        <Card className="rounded-lg border-slate-800 bg-white dark:bg-slate-900 p-6 text-slate-950 dark:text-slate-50 shadow-2xl">
          <div className="mb-6">
            <div className="flex size-10 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              <LockKeyhole className="size-5" aria-hidden="true" />
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight">Sign in</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Use your assigned facility or super-admin account.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </form>

          <div className="mt-4 flex items-center justify-center gap-4 text-center">
            <a href="/auth/forgot-password" className="text-sm text-emerald-700 hover:underline">
              Forgot your password?
            </a>
            <span className="text-slate-300">|</span>
            <a href="/auth/register" className="text-sm text-emerald-700 hover:underline">
              Register your facility
            </a>
          </div>

          <div className="mt-6 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-4 text-sm text-slate-600 dark:text-slate-400">
            Access is controlled by your facility administrator or Bulamu super administrator.
          </div>
        </Card>
      </div>
    </main>
  );
}
