'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { PwaRuntime } from '@/components/pwa-runtime';
import { OnboardingTour } from '@/components/onboarding-tour';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  
  // Pages without sidebar
  const noSidebarPages = ['/', '/auth/login'];
  const showSidebar = !noSidebarPages.includes(pathname);

  return (
    <>
      <PwaRuntime />
      {showSidebar && <OnboardingTour />}
      {showSidebar && <Sidebar />}
      <div className={showSidebar ? 'min-h-screen bg-slate-50 pl-72 pr-6 py-6' : ''}>
        {children}
      </div>
    </>
  );
}
