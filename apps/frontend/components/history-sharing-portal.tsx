'use client';

import { useCallback, useEffect, useState } from 'react';
import { Eye, History } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type Share = { id: string; facility: string; status: 'REQUESTED' | 'APPROVED' | 'DECLINED' | 'WITHDRAWN'; requestedAt: string; approvedAt: string | null; approvalMethod: string | null; endedAt: string | null };
type View = { facility: string; at: string };

const date = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTime = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const METHOD: Record<string, string> = { PIN: 'with your password at the facility', OTP: 'with a code we emailed you', PORTAL: 'here in your portal' };

/**
 * The patient decides which facilities may see their records from OTHER
 * facilities: approve or decline each request, stop sharing at any time, and
 * see every time a facility looked.
 */
export function HistorySharing() {
  const [shares, setShares] = useState<Share[]>([]);
  const [views, setViews] = useState<View[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patient-portal/history-sharing`, { headers: { Authorization: `Bearer ${localStorage.getItem('patientToken')}` } });
    const data = await res.json();
    if (data.success) {
      setShares(data.shares);
      setViews(data.views);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (share: Share, action: 'approve' | 'decline' | 'withdraw') => {
    const question = {
      approve: `Let ${share.facility} see your records from the other facilities you have visited (allergies, diagnoses, medicines, lab results and hospital stays)? You can stop sharing at any time.`,
      decline: `Decline ${share.facility}'s request? Nothing will be shared.`,
      withdraw: `Stop sharing your history with ${share.facility}? They will no longer be able to see your records from other facilities.`,
    }[action];
    if (!confirm(question)) return;
    setBusyId(share.id);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patient-portal/history-sharing/${share.id}/${action}`, {
        method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('patientToken')}` },
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Something went wrong');
      await load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const pending = shares.filter((s) => s.status === 'REQUESTED');
  const approved = shares.filter((s) => s.status === 'APPROVED');

  return (
    <section className="space-y-3" aria-labelledby="history-sharing-title">
      <div>
        <h2 id="history-sharing-title" className="flex items-center gap-2 text-lg font-semibold text-slate-950 dark:text-slate-50">
          <History className="size-5 text-emerald-700" aria-hidden="true" /> Sharing your history
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          A facility only sees your records from <em>other</em> facilities if you approve. They see your allergies, diagnoses, medicines, lab results and hospital stays -
          never reproductive-health records, doctors&apos; private notes, documents or bills.
        </p>
      </div>

      {pending.map((s) => (
        <Card key={s.id} className="rounded-lg border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="font-medium text-slate-900 dark:text-slate-100">{s.facility} is asking to see your history</p>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Asked on {date(s.requestedAt)}. Nothing is shared unless you approve.</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" disabled={busyId === s.id} onClick={() => decide(s, 'approve')}>Approve</Button>
            <Button size="sm" variant="outline" disabled={busyId === s.id} onClick={() => decide(s, 'decline')}>Decline</Button>
          </div>
        </Card>
      ))}

      {approved.length === 0 && pending.length === 0 ? (
        <Card className="rounded-lg p-4 text-sm text-slate-500 dark:text-slate-400">You are not sharing your history with any facility.</Card>
      ) : (
        approved.map((s) => (
          <Card key={s.id} className="flex items-start justify-between gap-3 rounded-lg p-4">
            <div>
              <p className="font-medium text-slate-900 dark:text-slate-100">{s.facility} can see your history</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">You approved on {date(s.approvedAt!)} {METHOD[s.approvalMethod ?? ''] ?? ''}.</p>
            </div>
            <Button size="sm" variant="outline" className="shrink-0 text-rose-600 hover:text-rose-700" disabled={busyId === s.id} onClick={() => decide(s, 'withdraw')}>Stop sharing</Button>
          </Card>
        ))
      )}

      {views.length > 0 && (
        <Card className="rounded-lg p-4">
          <p className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-slate-100"><Eye className="size-4" aria-hidden="true" /> Who has looked</p>
          <ul className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-400">
            {views.slice(0, 10).map((v, i) => <li key={i}>{v.facility} - {dateTime(v.at)}</li>)}
          </ul>
        </Card>
      )}
    </section>
  );
}
