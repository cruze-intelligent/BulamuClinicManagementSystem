'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ClipboardList, Pill, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { CompanyName } from '@/components/company-credit';
import { BrandLockup } from '@/components/brand';
import { SLOW_REQUEST_MESSAGE, useSlowNotice, useWarmUpBackend } from '@/lib/backend-warmup';
import { liveSessionUser, REMEMBERED_EMAIL_KEY, sessionEndMessage } from '@/lib/staff-session';

const REQUEST_TIMEOUT_MS = 90_000;

const FEATURES = [
  { icon: ClipboardList, title: "Every patient's record in one place", body: 'Visits, diagnoses, prescriptions, lab results and stays - from registration onwards.' },
  { icon: Pill, title: 'From the front desk to the pharmacy', body: "The doctor's prescription reaches the pharmacist, and the lab result reaches the doctor, without paper." },
  { icon: WifiOff, title: 'Keeps working without internet', body: 'Work is saved on the device and sent as soon as the connection comes back.' },
];

const ROLES = ['Administrators', 'Doctors', 'Clinical officers', 'Nurses', 'Midwives', 'Lab technicians', 'Pharmacists', 'Front desk', 'Patients'];

function loginErrorMessage(reason: string | undefined, rejectionReason: string | undefined): string | null {
  switch (reason) {
    case 'PENDING_APPROVAL':
      return "Your facility registration is still pending approval. We will email you as soon as it has been reviewed.";
    case 'REJECTED':
      return rejectionReason
        ? `Your facility registration was not approved: ${rejectionReason}`
        : 'Your facility registration was not approved. Contact us for details.';
    case 'SUSPENDED':
      return 'Your facility account is currently suspended. Contact your administrator or Bulamu support.';
    case 'ACCOUNT_DEACTIVATED':
      return 'Your account has been deactivated. Contact your facility administrator.';
    case 'DEMO_ENDED':
      return 'This demo has ended - thank you for trying Bulamu. To carry on with your own facility, register it for a free trial, or reply to the demo email and we will set up another.';
    default:
      return null;
  }
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [remember, setRemember] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    // Still signed in (e.g. "Keep me signed in") - no need for the form.
    const signedIn = liveSessionUser();
    if (signedIn) {
      router.replace(signedIn.role === 'SUPER_ADMIN' ? '/super-admin' : '/dashboard');
      return;
    }
    const remembered = localStorage.getItem(REMEMBERED_EMAIL_KEY);
    if (remembered) {
      setEmail(remembered);
      setRemember(true);
    }
    setNotice(sessionEndMessage(new URLSearchParams(window.location.search).get('session')));
  }, [router]);

  useWarmUpBackend();
  const slow = useSlowNotice(loading);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ email, password, remember }),
      });

      const data = await response.json();

      if (data.success) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        if (remember) localStorage.setItem(REMEMBERED_EMAIL_KEY, email.trim());
        else localStorage.removeItem(REMEMBERED_EMAIL_KEY);
        router.push(data.user.role === 'SUPER_ADMIN' ? '/super-admin' : '/dashboard');
      } else {
        setError(loginErrorMessage(data.reason, data.rejectionReason) || 'Invalid email or password');
      }
    } catch (err: any) {
      setError(
        err?.name === 'AbortError'
          ? 'Bulamu took too long to respond. Please try again.'
          : "We couldn't reach Bulamu. Please check your internet connection and try again."
      );
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 lg:grid lg:grid-cols-[minmax(0,44%)_1fr] dark:bg-slate-950">
      <section className="relative hidden overflow-hidden bg-[#04211d] px-12 py-12 text-white lg:flex lg:flex-col">
        <div aria-hidden="true" className="pointer-events-none absolute -right-40 -top-32 size-[30rem] rounded-full border border-emerald-400/15" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-10 size-[20rem] rounded-full border border-emerald-400/15" />
        <Link href="/" className="relative w-fit"><BrandLockup tone="dark" size="lg" /></Link>

        <div className="relative mt-16 max-w-lg">
          <h1 className="text-5xl font-extrabold leading-[1.05] tracking-tight">
            Patient care,<br /><span className="text-emerald-400">organised.</span>
          </h1>
          <p className="mt-5 text-xl font-medium text-slate-100">One home for everything your facility does.</p>

          <ul className="mt-10 space-y-6">
            {FEATURES.map((item) => (
              <li key={item.title} className="flex gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-emerald-300">
                  <item.icon className="size-5" aria-hidden="true" />
                </span>
                <span>
                  <span className="block font-semibold text-white">{item.title}</span>
                  <span className="mt-0.5 block text-sm leading-6 text-slate-300">{item.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mt-auto border-t border-white/10 pt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Everyone gets their own view</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {ROLES.map((role) => (
              <li key={role} className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-sm text-slate-200">{role}</li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-slate-400">
            Built for Uganda&apos;s clinics, health centres and hospitals. A product of <CompanyName className="hover:text-white hover:underline" />.
          </p>
        </div>
      </section>

      <section className="flex min-h-screen flex-col justify-center px-5 py-10 sm:px-10 lg:min-h-0">
        <div className="mx-auto w-full max-w-md">
          <Link href="/" className="mb-8 inline-block lg:hidden"><BrandLockup /></Link>
          <h2 className="text-3xl font-bold tracking-tight text-slate-950 dark:text-slate-50">Welcome back</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Sign in with the email address your facility set up for you.</p>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 dark:border-slate-800 dark:bg-slate-900">
            <form onSubmit={handleLogin} className="space-y-5">
              {notice && !error && (
                <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{notice}</p>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" autoComplete="username" className="h-11" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="password">Password</Label>
                  <a href="/auth/forgot-password" className="text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400">Forgot password?</a>
                </div>
                <PasswordInput id="password" name="password" autoComplete="current-password" className="[&_input]:h-11" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              <div className="flex items-start gap-2">
                <input
                  id="remember"
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="mt-0.5 size-4 rounded border-slate-300 accent-emerald-600"
                />
                <Label htmlFor="remember" className="block font-normal leading-snug">
                  Keep me signed in on this device
                  <span className="block text-xs text-slate-500 dark:text-slate-400">For 30 days. Only on a device that is yours - not a shared computer.</span>
                </Label>
              </div>
              {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
              {loading && slow && <p role="status" className="text-sm text-slate-500 dark:text-slate-400">{SLOW_REQUEST_MESSAGE}</p>}
              <Button type="submit" className="h-11 w-full text-base" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign in'}
                {!loading && <ArrowRight className="size-4" aria-hidden="true" />}
              </Button>
            </form>

            <div className="mt-6 border-t border-slate-200 pt-5 text-center text-sm text-slate-600 dark:border-slate-800 dark:text-slate-400">
              New to Bulamu?{' '}
              <a href="/auth/register" className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400">Register your facility</a>
            </div>
          </div>

          <p className="mt-6 text-center text-sm">
            <a href="/install" className="text-slate-600 hover:text-emerald-700 hover:underline dark:text-slate-400 dark:hover:text-emerald-400">
              Install Bulamu on this device
            </a>
          </p>
          <p className="mt-8 text-center text-xs text-slate-500 lg:hidden dark:text-slate-400">A product of <CompanyName className="hover:underline" />.</p>
        </div>
      </section>
    </main>
  );
}
