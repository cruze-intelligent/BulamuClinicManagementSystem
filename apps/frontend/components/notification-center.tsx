'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { NOTIFICATIONS_CHANGED_EVENT } from '@/lib/useUnreadNotifications';

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

type Preference = {
  type: string;
  label: string;
  description: string;
  emailAvailable: boolean;
  emailEnabled: boolean;
};

// Used by both the staff app (/notifications) and the patient portal
// (/patient-portal/notifications): the two APIs have the same shape and
// differ only in base path and which session token they use.
export function NotificationCenter({ basePath, tokenKey }: { basePath: string; tokenKey: string }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingPreferences, setSavingPreferences] = useState(false);

  const request = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const token = localStorage.getItem(tokenKey);
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${basePath}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      });
      return res.json();
    },
    [basePath, tokenKey]
  );

  const announceChange = () => window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));

  const load = useCallback(async () => {
    try {
      const [list, prefs] = await Promise.all([request(''), request('/preferences')]);
      if (list.success) {
        setNotifications(list.notifications);
        setUnreadCount(list.unreadCount);
      } else {
        setError(list.error || 'Unable to load notifications');
      }
      if (prefs.success) setPreferences(prefs.preferences);
    } catch {
      setError('Unable to reach the Bulamu API');
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    load();
  }, [load]);

  const markRead = async (id: string) => {
    setNotifications((current) => current.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)));
    setUnreadCount((count) => Math.max(0, count - 1));
    await request(`/${id}/read`, { method: 'POST' }).catch(() => {});
    announceChange();
  };

  const markAllRead = async () => {
    setNotifications((current) => current.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    setUnreadCount(0);
    await request('/read-all', { method: 'POST' }).catch(() => {});
    announceChange();
  };

  const toggleEmail = async (type: string) => {
    const next = preferences.map((p) => (p.type === type ? { ...p, emailEnabled: !p.emailEnabled } : p));
    setPreferences(next);
    setSavingPreferences(true);
    try {
      const data = await request('/preferences', {
        method: 'PUT',
        body: JSON.stringify({ emailDisabled: next.filter((p) => p.emailAvailable && !p.emailEnabled).map((p) => p.type) }),
      });
      if (data.success) setPreferences(data.preferences);
    } catch {
      setPreferences(preferences);
    } finally {
      setSavingPreferences(false);
    }
  };

  if (loading) return <p className="text-slate-500 dark:text-slate-400">Loading notifications...</p>;
  if (error) return <p className="text-red-600">{error}</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {unreadCount > 0 ? `${unreadCount} unread` : 'You are all caught up'}
        </p>
        {unreadCount > 0 && (
          <Button size="sm" variant="outline" onClick={markAllRead}>
            <CheckCheck className="size-4" aria-hidden="true" />
            Mark all as read
          </Button>
        )}
      </div>

      {notifications.length === 0 ? (
        <Card className="p-8 text-center">
          <Bell className="mx-auto size-6 text-slate-400" aria-hidden="true" />
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No notifications yet.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <Card
              key={n.id}
              className={`p-4 ${n.readAt ? '' : 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {!n.readAt && <span className="size-2 shrink-0 rounded-full bg-emerald-600" aria-label="Unread" />}
                    <p className="font-medium text-slate-900 dark:text-slate-100">{n.title}</p>
                  </div>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{n.body}</p>
                  <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{new Date(n.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {n.link && (
                    <Link href={n.link} onClick={() => !n.readAt && markRead(n.id)}>
                      <Button size="sm" variant="outline">View</Button>
                    </Link>
                  )}
                  {!n.readAt && (
                    <Button size="sm" variant="ghost" onClick={() => markRead(n.id)}>Mark read</Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {preferences.length > 0 && (
        <Card className="p-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Email preferences</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            You always see these here. Choose which ones are also emailed to you. Emails never contain patient or
            clinical details - they only tell you something needs your attention.
          </p>
          <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
            {preferences.map((p) => (
              <div key={p.type} className="flex items-start justify-between gap-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{p.label}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{p.description}</p>
                </div>
                {p.emailAvailable ? (
                  <label className="flex shrink-0 items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                    <input
                      type="checkbox"
                      checked={p.emailEnabled}
                      disabled={savingPreferences}
                      onChange={() => toggleEmail(p.type)}
                    />
                    Email me
                  </label>
                ) : (
                  <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">In-app only</span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
