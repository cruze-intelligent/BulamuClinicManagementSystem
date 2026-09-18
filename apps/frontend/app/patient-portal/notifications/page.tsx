'use client';

import { NotificationCenter } from '@/components/notification-center';

export default function PatientNotificationsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-950 dark:text-slate-50">Notifications</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Updates about your results, appointments and who can see your records.
        </p>
      </div>
      <NotificationCenter basePath="/patient-portal/notifications" tokenKey="patientToken" />
    </div>
  );
}
