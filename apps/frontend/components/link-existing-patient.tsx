'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';

type LookupResult = {
  portableId: string;
  name: string | null;
  dateOfBirth: string | null;
  sex: string | null;
  alreadyLinkedPatientId: string | null;
};

// Step 1: staff enter a patient's portable ID and get back only enough to
// visually confirm identity - never clinical data. Step 2: the patient
// proves it's really them (their own password, or an emailed OTP), which
// creates this facility's own Patient row plus the access grant that makes
// it visible in the patient's own aggregated portal view.
export function LinkExistingPatient() {
  const router = useRouter();
  const [portableId, setPortableId] = useState('');
  const [looking, setLooking] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [lookupError, setLookupError] = useState('');

  const [method, setMethod] = useState<'PIN' | 'OTP'>('PIN');
  const [password, setPassword] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState('');

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLooking(true);
    setLookupError('');
    setResult(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patients/lookup-account`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ portableId: portableId.trim().toUpperCase() }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Patient ID not found');
      setResult(data);
    } catch (error: any) {
      setLookupError(error.message);
    } finally {
      setLooking(false);
    }
  };

  const handleSendOtp = async () => {
    setSendingOtp(true);
    setLinkError('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patients/link-account/otp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ portableId: result!.portableId }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Could not send verification code');
      setOtpSent(true);
      if (data.devOtp) alert(`Dev mode - no email provider configured. Code: ${data.devOtp}`);
    } catch (error: any) {
      setLinkError(error.message);
    } finally {
      setSendingOtp(false);
    }
  };

  const handleLink = async () => {
    setLinking(true);
    setLinkError('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patients/link-account`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portableId: result!.portableId,
          method,
          ...(method === 'PIN' ? { password } : { otp }),
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Could not verify patient');
      router.push(`/patients/view?id=${data.patient.id}`);
    } catch (error: any) {
      setLinkError(error.message);
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          If this patient already has a Bulamu account from another facility, enter their Patient ID (e.g. BLM-P-XXXXXX)
          to link them here instead of creating a duplicate record. Requires an internet connection.
        </p>
        <form onSubmit={handleLookup} className="flex gap-2">
          <Input
            value={portableId}
            onChange={(e) => setPortableId(e.target.value)}
            placeholder="BLM-P-XXXXXX"
            className="font-mono"
            required
          />
          <Button type="submit" disabled={looking}>{looking ? 'Looking up...' : 'Look up'}</Button>
        </form>
        {lookupError && <p className="mt-2 text-sm text-rose-600">{lookupError}</p>}
      </Card>

      {result && (
        <Card className="p-6">
          <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Confirm this is the right patient</p>
          <p className="mt-1 text-lg font-semibold text-slate-800 dark:text-slate-200">{result.name || 'Unnamed patient'}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {result.sex || 'Sex not recorded'}
            {result.dateOfBirth ? ` - born ${new Date(result.dateOfBirth).toLocaleDateString()}` : ''}
          </p>

          {result.alreadyLinkedPatientId ? (
            <p className="mt-4 text-sm text-emerald-700 dark:text-emerald-500">
              This facility already has access to this patient's account.
            </p>
          ) : (
            <div className="mt-4 space-y-3 border-t pt-4">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Ask the patient to confirm it's them:
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant={method === 'PIN' ? 'default' : 'outline'} onClick={() => setMethod('PIN')}>
                  Their password
                </Button>
                <Button size="sm" variant={method === 'OTP' ? 'default' : 'outline'} onClick={() => setMethod('OTP')}>
                  Email code
                </Button>
              </div>

              {method === 'PIN' ? (
                <div>
                  <Label htmlFor="link-password" className="text-xs">Patient enters their portal password</Label>
                  <Input id="link-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
              ) : !otpSent ? (
                <Button size="sm" variant="outline" disabled={sendingOtp} onClick={handleSendOtp}>
                  {sendingOtp ? 'Sending...' : 'Send code to patient\'s email'}
                </Button>
              ) : (
                <div>
                  <Label htmlFor="link-otp" className="text-xs">Code from the patient's email</Label>
                  <Input id="link-otp" value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="6-digit code" />
                </div>
              )}

              {linkError && <p className="text-sm text-rose-600">{linkError}</p>}

              <Button
                disabled={linking || (method === 'PIN' ? !password : !otpSent || !otp)}
                onClick={handleLink}
              >
                {linking ? 'Verifying...' : 'Confirm and link patient'}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
