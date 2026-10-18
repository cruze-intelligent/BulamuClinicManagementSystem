'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FlaskConical, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

type Account = { roleTitle: string; name: string; email: string };
type Sent = { demoCode: string; password: string; expiresAt: string; accounts: Account[]; message: string };
type DemoUsage = {
  clinicId: string; demoCode: string | null; createdAt: string; expiresAt: string | null; open: boolean;
  signIns: number; failedSignIns: number; daysActive: number; lastSeenAt: string | null;
  rolesTried: string[]; recordsAdded: number; areasUsed: Array<{ area: string; count: number }>;
};
type Registered = { id: string; name: string; admin: { email: string } | null };

const api = (path: string, init: RequestInit = {}) =>
  fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}`, ...(init.headers || {}) },
  });

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';

/**
 * Sends someone a demo of their own: a private "Bulamu Test Facility" with a
 * sign-in for every role and a guided tour, open for 14 days. Every send is a
 * new demo, so logins already sent keep working. Below: how each demo has been
 * used - the only thing kept about it (never who it was sent to).
 */
export function DemoFacilityCard() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const [error, setError] = useState('');
  const [registered, setRegistered] = useState<Registered[]>([]);
  const [demos, setDemos] = useState<DemoUsage[] | null>(null);
  const [closing, setClosing] = useState<string | null>(null);

  const loadDemos = useCallback(async () => {
    try {
      const res = await api('/super-admin/demos');
      const data = await res.json().catch(() => ({}));
      setDemos(Array.isArray(data.demos) ? data.demos : []);
    } catch {
      setDemos([]);
    }
  }, []);

  useEffect(() => {
    void loadDemos();
    // Registered facilities, so a demo can go straight to one's administrator.
    api('/super-admin/overview')
      .then((res) => res.json())
      .then((data) => setRegistered((data.overview?.clinics || []).filter((c: Registered) => c.admin?.email)))
      .catch(() => setRegistered([]));
  }, [loadDemos]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSent(null);
    try {
      const res = await api('/super-admin/system/demo-facility', { method: 'POST', body: JSON.stringify({ email: email.trim() }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not create the demo');
      const message = data.result?.sent
        ? `A new demo was created and its sign-ins emailed to ${email.trim()}.`
        : `The demo was created, but the email did not go out (${data.result?.reason || 'unknown reason'}). Share the sign-ins below another way.`;
      setSent({ demoCode: data.demoCode, password: data.password, expiresAt: data.expiresAt, accounts: data.accounts, message });
      setEmail('');
      void loadDemos();
    } catch (err: any) {
      setError(err.message || 'Could not create the demo');
    } finally {
      setBusy(false);
    }
  };

  const close = async (demo: DemoUsage) => {
    if (!window.confirm(`Close demo ${demo.demoCode ?? ''} now? Its sign-ins stop working straight away.`)) return;
    setClosing(demo.clinicId);
    try {
      await api(`/super-admin/demos/${demo.clinicId}/close`, { method: 'POST', body: '{}' });
      await loadDemos();
    } finally {
      setClosing(null);
    }
  };

  return (
    <Card className="gap-4 p-4" data-testid="demo-facility">
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-medium"><FlaskConical className="size-4 text-emerald-700" aria-hidden="true" />Demos</h3>
        <p className="text-xs text-muted-foreground">
          Send anyone (a prospective client, or a registered facility that wants a proper guided tour) a demo of their own: a private
          &quot;Bulamu Test Facility&quot; filled with made-up records, a sign-in for every role and a step-by-step tour. It is open for
          14 days, never sends emails and never counts in the platform&apos;s figures. Each send is a new demo, so logins already sent
          keep working. Their email address is not kept: only how the demo is used.
        </p>
      </div>

      <form onSubmit={send} className="flex flex-wrap items-end gap-2">
        {registered.length > 0 && (
          <div className="min-w-52">
            <Label htmlFor="demo-facility-pick" className="text-xs">Registered facility (optional)</Label>
            <Select
              id="demo-facility-pick"
              value=""
              onChange={(e) => {
                const picked = registered.find((r) => r.id === e.target.value);
                if (picked?.admin?.email) setEmail(picked.admin.email);
              }}
            >
              <option value="">Choose to fill in its administrator...</option>
              {registered.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </div>
        )}
        <div className="min-w-60 flex-1">
          <Label htmlFor="demo-email" className="text-xs">Send the demo to</Label>
          <Input id="demo-email" type="email" required placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <Button type="submit" size="sm" disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {busy ? 'Creating the demo...' : 'Send a new demo'}
        </Button>
      </form>

      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-red-700 dark:text-red-400"><XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />{error}</p>
      )}
      {sent && (
        <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
          <p className="flex items-start gap-1.5 text-emerald-800 dark:text-emerald-300"><CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />{sent.message}</p>
          <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
            Demo <span className="font-mono">{sent.demoCode}</span> - every account uses the password{' '}
            <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{sent.password}</span> - open until {shortDate(sent.expiresAt)}.
          </p>
          <table className="mt-2 w-full text-left text-xs text-slate-700 dark:text-slate-300">
            <thead><tr className="text-slate-500"><th className="py-1 pr-2 font-medium">Role</th><th className="py-1 font-medium">Sign in with</th></tr></thead>
            <tbody>
              {sent.accounts.map((a) => (
                <tr key={a.email} className="border-t border-emerald-100 dark:border-emerald-900">
                  <td className="py-1 pr-2">{a.roleTitle}</td>
                  <td className="py-1 font-mono">{a.email}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">How the demos are being used</h4>
          <button type="button" onClick={() => void loadDemos()} className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline dark:text-emerald-400">
            <RefreshCw className="size-3" aria-hidden="true" />Refresh
          </button>
        </div>
        {demos === null ? (
          <p className="mt-2 text-xs text-muted-foreground">Loading...</p>
        ) : demos.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">No demos sent yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs" data-testid="demo-usage">
              <thead className="text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Demo</th>
                  <th className="py-1.5 pr-3 font-medium">Sent</th>
                  <th className="py-1.5 pr-3 font-medium">Status</th>
                  <th className="py-1.5 pr-3 font-medium">Sign-ins</th>
                  <th className="py-1.5 pr-3 font-medium">Days used</th>
                  <th className="py-1.5 pr-3 font-medium">Last seen</th>
                  <th className="py-1.5 pr-3 font-medium">Roles tried</th>
                  <th className="py-1.5 pr-3 font-medium">Records added</th>
                  <th className="py-1.5 font-medium"><span className="sr-only">Close</span></th>
                </tr>
              </thead>
              <tbody className="text-slate-700 dark:text-slate-300">
                {demos.map((d) => (
                  <tr key={d.clinicId} className="border-t border-slate-200 align-top dark:border-slate-800">
                    <td className="py-1.5 pr-3 font-mono">{d.demoCode ?? '-'}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{shortDate(d.createdAt)}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      {d.open
                        ? <span className="text-emerald-700 dark:text-emerald-400">Open until {shortDate(d.expiresAt)}</span>
                        : <span className="text-slate-500">Closed</span>}
                    </td>
                    <td className="py-1.5 pr-3">{d.signIns}{d.failedSignIns > 0 && <span className="text-slate-500"> ({d.failedSignIns} failed)</span>}</td>
                    <td className="py-1.5 pr-3">{d.daysActive}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Not yet'}</td>
                    <td className="py-1.5 pr-3">{d.rolesTried.length ? d.rolesTried.join(', ') : '-'}</td>
                    <td className="py-1.5 pr-3" title={d.areasUsed.map((a) => `${a.area}: ${a.count}`).join('\n')}>
                      {d.recordsAdded}{d.areasUsed.length > 0 && <span className="text-slate-500"> ({d.areasUsed.slice(0, 3).map((a) => a.area).join(', ')})</span>}
                    </td>
                    <td className="py-1.5 text-right">
                      {d.open && (
                        <button type="button" disabled={closing === d.clinicId} onClick={() => close(d)} className="text-rose-700 hover:underline disabled:opacity-50 dark:text-rose-400">
                          {closing === d.clinicId ? 'Closing...' : 'Close'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
