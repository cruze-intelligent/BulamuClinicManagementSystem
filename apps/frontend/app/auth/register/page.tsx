'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, ShieldCheck } from 'lucide-react';

const FACILITY_TYPES = [
  { value: 'CLINIC', label: 'Clinic' },
  { value: 'HEALTH_CENTRE_II', label: 'Health Centre II' },
  { value: 'HEALTH_CENTRE_III', label: 'Health Centre III' },
  { value: 'HEALTH_CENTRE_IV', label: 'Health Centre IV' },
  { value: 'HOSPITAL', label: 'Hospital' },
  { value: 'LABORATORY', label: 'Laboratory' },
  { value: 'PHARMACY', label: 'Pharmacy' },
  { value: 'COMMUNITY_OUTREACH', label: 'Community Outreach' },
  { value: 'MOBILE_UNIT', label: 'Mobile Unit' },
];

export default function RegisterFacilityPage() {
  const [facilityName, setFacilityName] = useState('');
  const [facilityType, setFacilityType] = useState('CLINIC');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [district, setDistrict] = useState('');
  const [subCounty, setSubCounty] = useState('');
  const [parish, setParish] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreed) {
      setError('You must agree to the Terms of Service and Privacy Policy to register.');
      return;
    }
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facilityName, facilityType, phone, address, district, subCounty, parish,
          adminName, adminEmail, adminPassword,
        }),
      });
      const data = await response.json();

      if (data.success) {
        setSubmitted(true);
      } else {
        setError(data.error || 'Registration failed');
      }
    } catch {
      setError('Unable to reach the Bulamu API. Confirm the backend is running and NEXT_PUBLIC_API_URL is configured.');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-10 text-white">
        <Card className="max-w-lg rounded-lg border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-slate-950 dark:text-slate-50 shadow-2xl">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="size-8" aria-hidden="true" />
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">Registration submitted</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
            Thank you for registering {facilityName || 'your facility'}. A Bulamu administrator will review your
            details and approve your account shortly. Once approved, sign in and you&apos;ll have full access with a
            2-week free trial.
          </p>
          <Button className="mt-6 w-full" onClick={() => (window.location.href = '/auth/login')}>
            Back to sign in
          </Button>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-md bg-emerald-500 text-slate-950 dark:text-slate-50">
            <ShieldCheck className="size-6" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Bulamu</h1>
            <p className="text-sm uppercase tracking-wide text-emerald-300">Medical Facility OS</p>
          </div>
        </div>

        <Card className="mt-8 rounded-lg border-slate-800 bg-white dark:bg-slate-900 p-6 text-slate-950 dark:text-slate-50 shadow-2xl">
          <h2 className="text-2xl font-semibold tracking-tight">Register your facility</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Get a 2-week free trial. Your account is reviewed and approved by a Bulamu administrator before go-live.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <Label htmlFor="facilityName">Facility Name</Label>
              <Input id="facilityName" value={facilityName} onChange={(e) => setFacilityName(e.target.value)} required />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="facilityType">Facility Type</Label>
                <select
                  id="facilityType"
                  value={facilityType}
                  onChange={(e) => setFacilityType(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                >
                  {FACILITY_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="phone">Facility Phone</Label>
                <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 0756123456" required />
              </div>
            </div>

            <div>
              <Label htmlFor="address">Address</Label>
              <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} required />
            </div>

            <div className="border-t pt-4">
              <p className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-400">Location (optional)</p>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="district">District</Label>
                  <Input id="district" value={district} onChange={(e) => setDistrict(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="subCounty">Sub-county</Label>
                  <Input id="subCounty" value={subCounty} onChange={(e) => setSubCounty(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="parish">Parish</Label>
                  <Input id="parish" value={parish} onChange={(e) => setParish(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <p className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-400">Facility Administrator Account</p>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="adminName">Full Name</Label>
                  <Input id="adminName" value={adminName} onChange={(e) => setAdminName(e.target.value)} required />
                </div>
                <div>
                  <Label htmlFor="adminEmail">Email</Label>
                  <Input id="adminEmail" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} required />
                </div>
                <div>
                  <Label htmlFor="adminPassword">Password</Label>
                  <Input id="adminPassword" type="password" minLength={10} value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} required />
                  <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">At least 10 characters.</p>
                </div>
              </div>
            </div>

            <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-400">
              <input type="checkbox" className="mt-0.5" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              <span>
                I agree to the{' '}
                <a href="/legal/terms" target="_blank" className="text-emerald-700 hover:underline">Terms of Service</a>{' '}
                and{' '}
                <a href="/legal/privacy" target="_blank" className="text-emerald-700 hover:underline">Privacy Policy</a>,
                including the 2-week free trial and monthly subscription described in the{' '}
                <a href="/legal/refund-policy" target="_blank" className="text-emerald-700 hover:underline">Refund Policy</a>.
              </span>
            </label>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Submitting...' : 'Submit for approval'}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <a href="/auth/login" className="text-sm text-emerald-700 hover:underline">Already have an account? Sign in</a>
          </div>
        </Card>
      </div>
    </main>
  );
}
