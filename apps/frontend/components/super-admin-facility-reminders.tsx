'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Mail, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { formatDateTime } from '@/lib/time';

const API = process.env.NEXT_PUBLIC_API_URL;
const REMINDERS = [
  { kind: 'INACTIVITY', label: '30-day inactivity check-in' },
  { kind: 'FEATURES', label: 'Recent features and workflows' },
  { kind: 'ONBOARDING', label: 'Setup and training support' },
  { kind: 'RETENTION', label: 'Data retention policy' },
] as const;
type ReminderKind = (typeof REMINDERS)[number]['kind'];
type FacilityCandidate = {
  id: string; name: string; facilityCode: string; lastActivityAt: string | null; idleDays: number;
  admin: { name: string; email: string } | null;
};

export function SuperAdminFacilityReminders() {
  const [facilities, setFacilities] = useState<FacilityCandidate[]>([]);
  const [facilityId, setFacilityId] = useState('');
  const [kind, setKind] = useState<ReminderKind>('INACTIVITY');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const selected = useMemo(() => facilities.find((facility) => facility.id === facilityId) ?? null, [facilities, facilityId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API}/super-admin/facility-reminders`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not load inactive facilities');
      const rows = (data.facilities as FacilityCandidate[]).sort((a, b) => b.idleDays - a.idleDays || a.name.localeCompare(b.name));
      setFacilities(rows);
      setFacilityId((current) => rows.some((facility) => facility.id === current) ? current : rows[0]?.id ?? '');
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Could not load inactive facilities');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const send = async () => {
    if (!selected?.admin) return;
    setSending(true);
    setMessage('');
    setError('');
    try {
      const response = await fetch(`${API}/super-admin/facility-reminders/${selected.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ kind }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'The reminder could not be sent');
      setMessage(data.sent ? `Email sent to ${data.recipient}.` : `Email was not delivered${data.reason ? `: ${data.reason}` : '.'}`);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'The reminder could not be sent');
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="rounded-lg p-5" data-testid="super-admin-facility-reminders">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Facility engagement reminders</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-500 dark:text-slate-400">Review approved facilities with no recorded activity for 30 days or more. Choose and send one of four messages manually; no reminder is sent automatically.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading || sending}>
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
        </Button>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]">
        <div>
          <label htmlFor="reminder-facility" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Facility</label>
          <Select id="reminder-facility" value={facilityId} onChange={(event) => { setFacilityId(event.target.value); setMessage(''); }} disabled={loading || facilities.length === 0}>
            {facilities.length === 0 && <option value="">{loading ? 'Loading facilities…' : 'No facilities idle for 30+ days'}</option>}
            {facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name} · {facility.idleDays} days idle</option>)}
          </Select>
        </div>
        <div>
          <label htmlFor="reminder-kind" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Email type</label>
          <Select id="reminder-kind" value={kind} onChange={(event) => { setKind(event.target.value as ReminderKind); setMessage(''); }}>
            {REMINDERS.map((reminder) => <option key={reminder.kind} value={reminder.kind}>{reminder.label}</option>)}
          </Select>
        </div>
        <div className="flex items-end">
          <Button type="button" onClick={() => void send()} disabled={!selected?.admin || sending || loading}>
            <Mail className="size-4" aria-hidden="true" />{sending ? 'Sending…' : 'Send reminder'}
          </Button>
        </div>
      </div>

      {selected && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{selected.admin ? `To ${selected.admin.name} · ${selected.admin.email}` : 'No active facility administrator is available to receive this email.'}{selected.lastActivityAt ? ` · Last recorded activity ${formatDateTime(selected.lastActivityAt)}` : ''}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-rose-700 dark:text-rose-400">{error}</p>}
      {message && <p role="status" className="mt-3 text-sm text-emerald-800 dark:text-emerald-300">{message}</p>}
      <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>Thirty days of inactivity does not delete facility data. The published schedule keeps clinical records while the facility account is active and for 5 years after the last entry; the documented erasure process is manual. Read the <a href="/legal/data-retention" className="font-medium underline">full retention policy</a>.</p>
      </div>
    </Card>
  );
}
