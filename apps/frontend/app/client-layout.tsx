'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { PwaRuntime } from '@/components/pwa-runtime';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  
  // Pages without sidebar
  const noSidebarPages = ['/', '/auth/login'];
  const showSidebar = !noSidebarPages.includes(pathname);

  return (
    <>
      <PwaRuntime />
      {showSidebar && <Sidebar />}
      <div className={showSidebar ? 'ml-64' : ''}>
        {children}
      </div>
    </>
  );
}
