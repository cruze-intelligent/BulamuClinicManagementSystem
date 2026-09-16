'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { PwaRuntime } from '@/components/pwa-runtime';
import { OnboardingTour } from '@/components/onboarding-tour';
import { TrialBanner } from '@/components/trial-banner';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Pages without sidebar
  const noSidebarPages = ['/', '/auth/login', '/auth/register', '/auth/forgot-password', '/auth/reset-password'];
  const noSidebarPrefixes = ['/legal/'];
  const showSidebar = !noSidebarPages.includes(pathname) && !noSidebarPrefixes.some((prefix) => pathname.startsWith(prefix));

  return (
    <>
      <PwaRuntime />
      {showSidebar && <OnboardingTour />}
      {showSidebar && <Sidebar />}
      <div className={showSidebar ? 'min-h-screen bg-slate-50 pl-72 pr-6 py-6' : ''}>
        {showSidebar && <TrialBanner />}
        {children}
      </div>
    </>
  );
}
