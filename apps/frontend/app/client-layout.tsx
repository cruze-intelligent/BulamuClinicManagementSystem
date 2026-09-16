'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { PwaRuntime } from '@/components/pwa-runtime';
import { OnboardingTour } from '@/components/onboarding-tour';
import { TrialBanner } from '@/components/trial-banner';
import { useSidebar } from '@/lib/sidebar-provider';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { collapsed } = useSidebar();

  // Pages without sidebar
  const noSidebarPages = ['/', '/auth/login', '/auth/register', '/auth/forgot-password', '/auth/reset-password'];
  const noSidebarPrefixes = ['/legal/'];
  const showSidebar = !noSidebarPages.includes(pathname) && !noSidebarPrefixes.some((prefix) => pathname.startsWith(prefix));

  return (
    <>
      <PwaRuntime />
      {showSidebar && <OnboardingTour />}
      {showSidebar && <Sidebar />}
      <div
        className={
          showSidebar
            ? `min-h-screen bg-slate-50 pr-6 py-6 transition-[padding] duration-200 dark:bg-slate-950 ${collapsed ? 'pl-[6.5rem]' : 'pl-72'}`
            : ''
        }
      >
        {showSidebar && <TrialBanner />}
        {children}
      </div>
    </>
  );
}
