'use client';

import { NotificationCenter } from '@/components/notification-center';

export default function NotificationsPage() {
  return (
    <div className="min-h-screen p-8 bg-slate-50 dark:bg-slate-950">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold mb-1 text-slate-800 dark:text-slate-200">Notifications</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          Alerts relevant to your role at this facility.
        </p>
        <NotificationCenter basePath="/notifications" tokenKey="token" />
      </div>
    </div>
  );
}
