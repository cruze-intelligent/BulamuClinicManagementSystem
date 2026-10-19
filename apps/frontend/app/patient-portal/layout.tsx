'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, FileHeart, LogOut, Users } from 'lucide-react';
import { BrandMark } from '@/components/brand';
import { clearPatientSession } from '@/lib/usePatientAuth';
import { tokenExpiry } from '@/lib/staff-session';
import { useUnreadNotifications } from '@/lib/useUnreadNotifications';

const PUBLIC_PAGES = ['/patient-portal/login', '/patient-portal/set-password', '/patient-portal/forgot-password'];
// Pages that bring their own full-screen design, without the portal's header.
const FULL_SCREEN_PAGES = ['/patient-portal/login'];

const NAV = [
  { href: '/patient-portal/dashboard', label: 'My records', icon: FileHeart },
  { href: '/patient-portal/notifications', label: 'Notifications', icon: Bell },
  { href: '/patient-portal/access', label: 'Sharing', icon: Users, title: 'Who can see your records' },
];

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
    // A sign-in lasts 12 hours: after that, say so rather than show pages that can't load.
    const expiry = tokenExpiry(token);
    if (expiry !== null && expiry <= Date.now()) {
      clearPatientSession();
      router.replace('/patient-portal/login?session=expired');
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

  if (FULL_SCREEN_PAGES.includes(normalizedPathname)) return <>{children}</>;
  if (!isPublicPage && !authChecked) return null;

  const navClass = (active: boolean) =>
    `relative flex flex-col items-center gap-0.5 whitespace-nowrap rounded-md px-2 py-1.5 text-[11px] font-medium sm:flex-row sm:gap-1.5 sm:px-3 sm:text-sm ${
      active
        ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
    }`;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <Link href={isPublicPage ? '/' : '/patient-portal/dashboard'} className="flex items-center gap-2">
            <BrandMark className="size-8" />
            <div className={isPublicPage ? '' : 'hidden sm:block'}>
              <span className="block text-sm font-semibold leading-tight text-slate-950 dark:text-slate-50">Bulamu</span>
              <span className="block text-[11px] leading-tight text-slate-500 dark:text-slate-400">Patient Portal</span>
            </div>
          </Link>
          {!isPublicPage && (
            <nav aria-label="Patient Portal" className="flex items-center gap-0.5 sm:gap-1">
              {NAV.map((item) => {
                const active = normalizedPathname === item.href;
                return (
                  <Link key={item.href} href={item.href} title={item.title ?? item.label} aria-current={active ? 'page' : undefined} className={navClass(active)}>
                    <item.icon className="size-4" aria-hidden="true" />
                    <span>{item.label}</span>
                    {item.href.endsWith('/notifications') && unreadNotifications > 0 && (
                      <span
                        aria-label={`${unreadNotifications} unread`}
                        className="absolute -top-0.5 right-0.5 rounded-full bg-emerald-600 px-1.5 text-[10px] font-semibold leading-4 text-white sm:static sm:text-[11px] sm:leading-5"
                      >
                        {unreadNotifications > 99 ? '99+' : unreadNotifications}
                      </span>
                    )}
                  </Link>
                );
              })}
              <button onClick={handleLogout} title="Sign out" className={navClass(false)}>
                <LogOut className="size-4" aria-hidden="true" />
                <span>Sign out</span>
              </button>
            </nav>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
