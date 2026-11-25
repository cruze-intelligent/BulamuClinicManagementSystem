'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Bell, FilePenLine, MessageSquare, RefreshCw, UserRoundPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const API = process.env.NEXT_PUBLIC_API_URL;
type Props = { pendingFacilities: number };

export function SuperAdminNotificationPanel({ pendingFacilities }: Props) {
  const [pendingChanges, setPendingChanges] = useState(0);
  const [unreadSupport, setUnreadSupport] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const auth = { Authorization: `Bearer ${localStorage.getItem('token')}` };
      const [changesResponse, supportResponse] = await Promise.all([
        fetch(`${API}/super-admin/facility-changes`, { headers: auth }),
        fetch(`${API}/chat/super-admin/unread-count`, { headers: auth }),
      ]);
      const [changes, support] = await Promise.all([changesResponse.json(), supportResponse.json()]);
      if (!changesResponse.ok || !changes.success) throw new Error(changes.error || 'Could not load facility reviews');
      if (!supportResponse.ok || !support.success) throw new Error(support.error || 'Could not load support messages');
      setPendingChanges(changes.changes.length);
      setUnreadSupport(support.count);
      setError('');
    } catch (error: unknown) { setError(error instanceof Error ? error.message : 'Notifications are temporarily unavailable'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const items = [
    { title: 'Facility registrations', detail: pendingFacilities ? 'Review new facilities before they can sign in.' : 'No registrations are waiting.', count: pendingFacilities, href: '#pending-approvals', icon: UserRoundPlus },
    { title: 'Facility detail changes', detail: pendingChanges ? 'Review requested changes to facility details.' : 'No facility changes need review.', count: pendingChanges, href: '#facility-change-reviews', icon: FilePenLine },
    { title: 'Support messages', detail: unreadSupport ? 'Facility replies are waiting for your team.' : 'No unread facility messages.', count: unreadSupport, href: '/super-admin/messages', icon: MessageSquare },
  ];

  return <Card className="overflow-hidden rounded-xl border-slate-200 dark:border-slate-800" aria-labelledby="admin-notifications-title">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex items-center gap-3"><span className="rounded-lg bg-emerald-100 p-2 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"><Bell className="size-5" aria-hidden="true" /></span><div><h2 id="admin-notifications-title" className="font-semibold">Notifications</h2><p className="text-xs text-slate-500 dark:text-slate-400">Items that need platform administrator attention</p></div></div>
      <Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh</Button>
    </div>
    {error && <p role="status" className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{error}</p>}
    <div className="divide-y divide-slate-100 dark:divide-slate-800 sm:grid sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {items.map((item) => <Link key={item.title} href={item.href} className="group flex min-h-24 items-start gap-3 p-4 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-700 dark:hover:bg-slate-900">
        <span className={`mt-0.5 rounded-lg p-2 ${item.count ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}><item.icon className="size-4" aria-hidden="true" /></span>
        <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="font-medium">{item.title}</span><span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${item.count ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{loading && item.title !== 'Facility registrations' ? '…' : item.count}</span></span><span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{item.detail}</span></span>
        <ArrowRight className="mt-1 size-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </Link>)}
    </div>
  </Card>;
}
