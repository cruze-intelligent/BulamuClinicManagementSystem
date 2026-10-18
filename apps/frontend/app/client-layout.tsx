'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Menu } from 'lucide-react';
import { BrandMark } from '@/components/brand';
import { Sidebar } from '@/components/sidebar';
import { PwaRuntime } from '@/components/pwa-runtime';
import { OnboardingTour } from '@/components/onboarding-tour';
import { TrialBanner } from '@/components/trial-banner';
import { useSidebar } from '@/lib/sidebar-provider';
import { useAuth, getHomePath } from '@/lib/useAuth';
import { clearStaffSession, loginPathFor, tokenExpiry, watchForEndedSession, type SessionEndReason } from '@/lib/staff-session';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { collapsed, openMobile } = useSidebar();
  const { user } = useAuth();
  const [authChecked, setAuthChecked] = useState(false);

  // The static export runs with trailingSlash: true, so usePathname() returns
  // "/auth/register/" at runtime - strip the trailing slash before matching
  // against these routes, otherwise the comparison below never matches and
  // public pages incorrectly get treated as sidebar (auth-required) pages.
  const normalizedPathname = pathname !== '/' && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

  // Pages without sidebar
  const noSidebarPages = ['/', '/install', '/auth/login', '/auth/register', '/auth/forgot-password', '/auth/reset-password'];
  const noSidebarPrefixes = ['/legal/', '/patient-portal/'];
  const showSidebar = !noSidebarPages.includes(normalizedPathname) && !noSidebarPrefixes.some((prefix) => normalizedPathname.startsWith(prefix));

  // Checked on every navigation: a session that is missing or has run out goes
  // straight to sign-in rather than leaving pages that can't load anything.
  useEffect(() => {
    if (!showSidebar) return;
    const endSession = (reason: SessionEndReason) => {
      clearStaffSession();
      setAuthChecked(false);
      router.replace(loginPathFor(reason));
    };
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');
    if (!token || !user) {
      setAuthChecked(false);
      router.replace('/auth/login');
      return;
    }
    // A session that has run out ends once the device is online - offline,
    // signing in again is impossible, so work recorded on the device carries
    // on and is sent after the next sign-in.
    const expiry = tokenExpiry(token);
    const expired = () => expiry !== null && expiry <= Date.now();
    if (expired() && navigator.onLine) {
      endSession('expired');
      return;
    }
    setAuthChecked(true);

    const endIfExpired = () => {
      if (expired() && navigator.onLine) endSession('expired');
    };
    const stopWatching = watchForEndedSession(() => endSession('ended'));
    const timer = expiry !== null ? setTimeout(endIfExpired, Math.min(Math.max(expiry - Date.now(), 0) + 1000, 2_147_483_647)) : undefined;
    window.addEventListener('online', endIfExpired);
    return () => {
      stopWatching();
      if (timer) clearTimeout(timer);
      window.removeEventListener('online', endIfExpired);
    };
  }, [pathname, showSidebar, router]);

  // Every protected route requires a valid session before it renders or
  // fetches anything - prevents unauthenticated visits from hitting API
  // endpoints with an empty user object (e.g. /dashboard/undefined).
  if (showSidebar && !authChecked) return null;

  return (
    <>
      <PwaRuntime showWidget={showSidebar} />
      {showSidebar && <OnboardingTour />}
      {showSidebar && <Sidebar />}
      {showSidebar && (
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 lg:hidden dark:border-slate-800 dark:bg-slate-900">
          <button
            onClick={openMobile}
            aria-label="Open menu"
            className="flex size-9 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
          <Link href={getHomePath(user)} className="flex items-center gap-2">
            <BrandMark className="size-7" />
            <span className="font-semibold text-slate-950 dark:text-slate-50">Bulamu</span>
          </Link>
        </header>
      )}
      <div
        className={
          showSidebar
            ? `min-h-screen bg-slate-50 px-4 pb-20 pt-4 sm:px-6 sm:pb-24 sm:pt-6 transition-[padding] duration-200 dark:bg-slate-950 ${collapsed ? 'lg:pl-[6.5rem]' : 'lg:pl-72'}`
            : ''
        }
      >
        {showSidebar && <TrialBanner />}
        {children}
      </div>
    </>
  );
}
