'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, LogOut, ShieldCheck, Users } from 'lucide-react';
import { usePatientAuth, clearPatientSession } from '@/lib/usePatientAuth';
import { useUnreadNotifications } from '@/lib/useUnreadNotifications';

const PUBLIC_PAGES = ['/patient-portal/login', '/patient-portal/set-password', '/patient-portal/forgot-password'];

export default function PatientPortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  const normalizedPathname = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const isPublicPage = PUBLIC_PAGES.includes(normalizedPathname);

  useEffect(() => {
    setAuthChecked(false);
    if (isPublicPage) return;
    const token = localStorage.getItem('patientToken');
    if (!token) {
      router.replace('/patient-portal/login');
      return;
    }
    setAuthChecked(true);
  }, [pathname, isPublicPage, router]);

  const unreadNotifications = useUnreadNotifications(
    '/patient-portal/notifications/unread-count',
    'patientToken',
    !isPublicPage && authChecked
  );

  const handleLogout = () => {
    clearPatientSession();
    router.replace('/patient-portal/login');
  };

  if (!isPublicPage && !authChecked) return null;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link href={isPublicPage ? '/' : '/patient-portal/dashboard'} className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-md bg-emerald-700 text-white">
              <ShieldCheck className="size-4" aria-hidden="true" />
            </div>
            <div>
              <span className="block text-sm font-semibold leading-tight text-slate-950 dark:text-slate-50">Bulamu</span>
              <span className="block text-[11px] leading-tight text-slate-500 dark:text-slate-400">Patient Portal</span>
            </div>
          </Link>
          {!isPublicPage && (
            <div className="flex items-center gap-1">
              <Link
                href="/patient-portal/notifications"
                title="Notifications"
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <Bell className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">Notifications</span>
                {unreadNotifications > 0 && (
                  <span aria-label={`${unreadNotifications} unread`} className="rounded-full bg-emerald-600 px-1.5 text-[11px] font-semibold leading-5 text-white">
                    {unreadNotifications > 99 ? '99+' : unreadNotifications}
                  </span>
                )}
              </Link>
              <Link
                href="/patient-portal/access"
                title="Access to your records"
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <Users className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">Access</span>
              </Link>
              <button
                onClick={handleLogout}
                title="Sign out"
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <LogOut className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
