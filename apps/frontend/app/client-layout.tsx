'use client';

import { usePathname } from 'next/navigation';
import { Menu, ShieldCheck } from 'lucide-react';
import { Sidebar } from '@/components/sidebar';
import { PwaRuntime } from '@/components/pwa-runtime';
import { OnboardingTour } from '@/components/onboarding-tour';
import { TrialBanner } from '@/components/trial-banner';
import { useSidebar } from '@/lib/sidebar-provider';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { collapsed, openMobile } = useSidebar();

  // Pages without sidebar
  const noSidebarPages = ['/', '/auth/login', '/auth/register', '/auth/forgot-password', '/auth/reset-password'];
  const noSidebarPrefixes = ['/legal/'];
  const showSidebar = !noSidebarPages.includes(pathname) && !noSidebarPrefixes.some((prefix) => pathname.startsWith(prefix));

  return (
    <>
      <PwaRuntime />
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
          <div className="flex items-center gap-2">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-emerald-700 text-white">
              <ShieldCheck className="size-4" aria-hidden="true" />
            </div>
            <span className="font-semibold text-slate-950 dark:text-slate-50">Bulamu</span>
          </div>
        </header>
      )}
      <div
        className={
          showSidebar
            ? `min-h-screen bg-slate-50 px-4 py-4 sm:px-6 sm:py-6 transition-[padding] duration-200 dark:bg-slate-950 ${collapsed ? 'lg:pl-[6.5rem]' : 'lg:pl-72'}`
            : ''
        }
      >
        {showSidebar && <TrialBanner />}
        {children}
      </div>
    </>
  );
}
