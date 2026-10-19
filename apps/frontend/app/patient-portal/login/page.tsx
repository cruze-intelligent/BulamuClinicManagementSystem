'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, CalendarPlus, FlaskConical, Receipt, ShieldCheck, Stethoscope } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { BrandLockup } from '@/components/brand';
import { CompanyName } from '@/components/company-credit';
import { savePatientSession } from '@/lib/usePatientAuth';
import { SLOW_REQUEST_MESSAGE, useSlowNotice, useWarmUpBackend } from '@/lib/backend-warmup';

const INSIDE = [
  { icon: Stethoscope, title: 'Your visits', body: 'What the clinician found, and the medicines prescribed - with a prescription you can print.' },
  { icon: FlaskConical, title: 'Your lab results', body: 'As soon as a clinician has checked them, not before.' },
  { icon: Receipt, title: 'Your bills and receipts', body: 'What each visit cost, what you have paid, and a copy of every receipt.' },
  { icon: CalendarPlus, title: 'Appointments', body: 'Ask your facility for one, and see when it is confirmed.' },
  { icon: ShieldCheck, title: 'You decide who sees them', body: 'Another facility sees your history only if you allow it.' },
];

/** Why a session ended, from ?session= on the way back to sign-in. */
const SESSION_MESSAGES: Record<string, string> = {
  expired: 'You were signed out to keep your records safe. Please sign in again.',
};

export default function PatientPortalLoginPage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // A staff sign-in typed here: the error points to the staff page.
  const [staffSignIn, setStaffSignIn] = useState(false);
  const router = useRouter();
  useWarmUpBackend();
  const slow = useSlowNotice(loading);

  useEffect(() => {
    // Still signed in: straight to the records.
    if (localStorage.getItem('patientToken')) {
      router.replace('/patient-portal/dashboard');
      return;
    }
    setNotice(SESSION_MESSAGES[new URLSearchParams(window.location.search).get('session') ?? ''] ?? '');
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setStaffSignIn(false);
    setLoading(true);

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patient-auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });
      const data = await response.json();

      if (data.success) {
        savePatientSession(data.token, data.patient);
        router.push('/patient-portal/dashboard');
      } else if (data.reason === 'STAFF_ACCOUNT') {
        setStaffSignIn(true);
        setError('That is a staff sign-in. Facility staff sign in on the staff page, with the same password.');
      } else if (data.reason === 'DEMO_ENDED') {
        setError('This demo has ended - thank you for trying Bulamu.');
      } else if (response.status === 429) {
        setError('Too many tries. Please wait 15 minutes, or reset your password.');
      } else {
        setError(data.error === 'Invalid credentials' || !data.error ? 'That Patient ID, email or phone number and password do not match.' : data.error);
      }
    } catch {
      setError("We couldn't reach Bulamu. Please check your internet connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 lg:grid lg:grid-cols-[minmax(0,44%)_1fr] dark:bg-slate-950">
      <section className="relative hidden overflow-hidden bg-[#04211d] px-12 py-12 text-white lg:flex lg:flex-col">
        <div aria-hidden="true" className="pointer-events-none absolute -right-40 -top-32 size-[30rem] rounded-full border border-emerald-400/15" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-10 size-[20rem] rounded-full border border-emerald-400/15" />
        <Link href="/" className="relative w-fit"><BrandLockup tone="dark" size="lg" /></Link>

        <div className="relative mt-14 max-w-lg">
          <p className="text-sm font-semibold uppercase tracking-wider text-emerald-300">Patient Portal</p>
          <h1 className="mt-3 text-5xl font-extrabold leading-[1.05] tracking-tight">
            Your health records,<br /><span className="text-emerald-400">in your hands.</span>
          </h1>
          <p className="mt-5 text-lg text-slate-200">See what your facility records about you, as soon as it is ready - on your phone, any time.</p>

          <ul className="mt-9 space-y-5">
            {INSIDE.map((item) => (
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

        <p className="relative mt-auto border-t border-white/10 pt-6 text-sm text-slate-400">
          Your records stay private: only you, and the facilities you allow, can see them. A product of <CompanyName className="hover:text-white hover:underline" />.
        </p>
      </section>

      <section className="flex min-h-screen flex-col justify-center px-5 py-10 sm:px-10 lg:min-h-0">
        <div className="mx-auto w-full max-w-md">
          <Link href="/" className="mb-6 inline-block lg:hidden"><BrandLockup /></Link>
          <p className="text-sm font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Patient Portal</p>
          <h2 className="mt-1 text-3xl font-bold tracking-tight text-slate-950 dark:text-slate-50">Sign in to your records</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Your visits, lab results, bills and appointments from the facilities that treat you.
          </p>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 dark:border-slate-800 dark:bg-slate-900">
            <form onSubmit={handleLogin} className="space-y-5">
              {notice && !error && (
                <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{notice}</p>
              )}
              <div className="space-y-2">
                <Label htmlFor="identifier">Patient ID, email or phone number</Label>
                <Input
                  id="identifier" name="identifier" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  className="h-11" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required aria-describedby="identifier-help"
                />
                <p id="identifier-help" className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                  Your Patient ID looks like <span className="font-mono font-medium text-slate-700 dark:text-slate-300">BLM-P-7K2M9Q</span> and is in the email your facility sent you.
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="password">Password</Label>
                  <a href="/patient-portal/forgot-password" className="text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400">Forgot password?</a>
                </div>
                <PasswordInput id="password" name="password" autoComplete="current-password" className="[&_input]:h-11" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              {error && (
                <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
                  {error}
                  {staffSignIn && (
                    <>
                      {' '}
                      <a href="/auth/login" className="font-semibold underline">Go to the staff sign-in</a>
                    </>
                  )}
                </p>
              )}
              {loading && slow && <p role="status" className="text-sm text-slate-500 dark:text-slate-400">{SLOW_REQUEST_MESSAGE}</p>}
              <Button type="submit" className="h-11 w-full text-base" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign in'}
                {!loading && <ArrowRight className="size-4" aria-hidden="true" />}
              </Button>
            </form>

            <div className="mt-6 border-t border-slate-200 pt-5 text-sm leading-6 text-slate-600 dark:border-slate-800 dark:text-slate-400">
              <p className="font-semibold text-slate-800 dark:text-slate-200">First time here?</p>
              <p>
                Your facility creates your account and emails you a link to choose a password. No email? Ask the front desk at your next visit to send it again.
              </p>
            </div>
          </div>

          <p className="mt-6 text-center text-sm text-slate-600 dark:text-slate-400">
            Facility staff?{' '}
            <a href="/auth/login" className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400">Sign in here</a>
          </p>
          <p className="mt-8 text-center text-xs text-slate-500 lg:hidden dark:text-slate-400">
            Your records stay private: only you, and the facilities you allow, can see them.
          </p>
        </div>
      </section>
    </main>
  );
}
