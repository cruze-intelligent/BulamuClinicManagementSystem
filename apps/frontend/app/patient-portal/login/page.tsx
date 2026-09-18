'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { savePatientSession } from '@/lib/usePatientAuth';
import { useWarmUpBackend } from '@/lib/backend-warmup';

export default function PatientPortalLoginPage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  useWarmUpBackend();
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
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
      } else {
        alert(data.error || 'Invalid credentials');
      }
    } catch {
      alert('Unable to reach the Bulamu API. Please try again shortly.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <Card className="w-full max-w-sm rounded-lg border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-6">
          <div className="flex size-10 items-center justify-center rounded-md bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            <LockKeyhole className="size-5" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">Sign in to your records</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Use your Patient ID, email, or phone number.
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <Label htmlFor="identifier">Patient ID, email, or phone</Label>
            <Input id="identifier" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
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

        <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
          Your account is created by the facility that registers you. Check your email for a set-password link.
        </p>
      </Card>
    </div>
  );
}
