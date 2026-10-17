'use client';

import { useState } from 'react';
import { CheckCircle2, FlaskConical, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Account = { roleTitle: string; name: string; email: string; password: string };

/**
 * Creates "Bulamu Test Facility" - an account for every role and made-up work
 * to click through - and emails its logins. Pressing it again issues fresh
 * passwords (the demo data stays).
 */
export function DemoFacilityCard() {
  const [email, setEmail] = useState('admin@scholara.site');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string; accounts?: Account[] } | null>(null);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/super-admin/system/demo-facility`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Request failed');
      const what = data.created ? `Bulamu Test Facility created (${data.facilityCode}).` : 'Fresh passwords issued for Bulamu Test Facility.';
      const mail = data.result?.sent ? `The logins were emailed to ${email}.` : `The email did not go out (${data.result?.reason || 'unknown reason'}) - use the logins below.`;
      setOutcome({ ok: true, message: `${what} ${mail}`, accounts: data.accounts });
    } catch (error: any) {
      setOutcome({ ok: false, message: error.message || 'Request failed' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4 gap-3" data-testid="demo-facility">
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-medium"><FlaskConical className="size-4 text-emerald-700" aria-hidden="true" />Demo facility</h3>
        <p className="text-xs text-muted-foreground">
          &quot;Bulamu Test Facility&quot; has an account for every role and made-up patients, visits, prescriptions, lab results, stock, wards
          and invoices, for showing Bulamu to clients. It is left out of all platform figures and its staff get no emails. Running this
          again issues fresh passwords and keeps the demo data.
        </p>
      </div>
      <form onSubmit={run} className="flex flex-wrap items-end gap-2">
        <div className="min-w-60 flex-1">
          <Label htmlFor="demo-email" className="text-xs">Email the logins to</Label>
          <Input id="demo-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={busy}>{busy ? 'Working...' : 'Create demo / send fresh logins'}</Button>
      </form>
      {outcome && (
        <div role="status" className={`text-sm ${outcome.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
          <p className="flex items-start gap-1.5">
            {outcome.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />}
            {outcome.message}
          </p>
          {outcome.accounts && (
            <table className="mt-2 w-full text-left text-xs text-slate-700 dark:text-slate-300">
              <thead><tr className="text-slate-500"><th className="py-1 pr-2 font-medium">Role</th><th className="py-1 pr-2 font-medium">Email</th><th className="py-1 font-medium">Password</th></tr></thead>
              <tbody>
                {outcome.accounts.map((a) => (
                  <tr key={a.email} className="border-t border-slate-200 dark:border-slate-800">
                    <td className="py-1 pr-2">{a.roleTitle}</td>
                    <td className="py-1 pr-2">{a.email}</td>
                    <td className="py-1 font-mono">{a.password}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Card>
  );
}
