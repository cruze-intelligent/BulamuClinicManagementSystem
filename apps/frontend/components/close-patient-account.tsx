'use client';

import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { clearPatientSession } from '@/lib/usePatientAuth';

// Self-service closure of the patient's own portal account. What it erases and
// what it keeps is set out in the Data Retention and Deletion Policy
// (/legal/data-retention, section 4.4) - keep this text in step with it.
export function ClosePatientAccount() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState('');
  const [closed, setClosed] = useState(false);

  const handleClose = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setClosing(true);
    try {
      const token = localStorage.getItem('patientToken');
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patient-portal/account/close`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.status === 429) {
        setError('Too many attempts. Please wait a few minutes and try again.');
        return;
      }
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Could not close the account');
        return;
      }
      clearPatientSession();
      setClosed(true);
      setTimeout(() => {
        window.location.href = '/patient-portal/login';
      }, 4000);
    } catch {
      setError('Unable to reach the Bulamu API. Please try again.');
    } finally {
      setClosing(false);
    }
  };

  if (closed) {
    return (
      <Card className="rounded-lg border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900 dark:bg-emerald-950/30">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="size-5 text-emerald-700" aria-hidden="true" />
          <p className="font-medium text-slate-900 dark:text-slate-100">Your account has been closed</p>
        </div>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          We have sent a confirmation to your previous email address. Taking you to the sign-in page...
        </p>
      </Card>
    );
  }

  return (
    <Card className="rounded-lg border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-base font-semibold text-slate-950 dark:text-slate-50">Close your account</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        You can close your Patient Portal account at any time. This cannot be undone.
      </p>

      {!open ? (
        <Button size="sm" variant="outline" className="mt-4 text-rose-600 hover:text-rose-700" onClick={() => setOpen(true)}>
          Close my account...
        </Button>
      ) : (
        <form onSubmit={handleClose} className="mt-4 space-y-4">
          <div className="grid gap-4 text-sm text-slate-600 dark:text-slate-400 sm:grid-cols-2">
            <div>
              <p className="font-medium text-slate-800 dark:text-slate-200">Erased straight away</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>Your email address, phone number and password on this account</li>
                <li>Your notifications and email preferences</li>
                <li>Every document you uploaded yourself</li>
                <li>Every facility&apos;s access to your records through this account</li>
              </ul>
            </div>
            <div>
              <p className="font-medium text-slate-800 dark:text-slate-200">Kept, and why</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>
                  The clinical records each facility holds about you - facilities are required to keep them. They are
                  no longer linked to a portal account.
                </li>
                <li>Appointment requests you sent, and a record that this account was closed.</li>
              </ul>
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Read the full{' '}
            <a href="/legal/data-retention" target="_blank" className="text-emerald-700 hover:underline">
              Data Retention and Deletion Policy
            </a>
            .
          </p>

          <div>
            <Label htmlFor="close-password">Confirm with your password</Label>
            <Input id="close-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-400">
            <input type="checkbox" className="mt-0.5" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
            I understand that closing my account cannot be undone.
          </label>

          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="destructive" disabled={closing || !understood || !password}>
              {closing ? 'Closing...' : 'Permanently close my account'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setOpen(false); setPassword(''); setUnderstood(false); setError(''); }}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
