'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

export function useAuthCheck() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Skip auth check on public pages
    const publicPages = ['/', '/auth/login'];
    if (publicPages.includes(pathname)) return;

    const checkAuth = () => {
      const token = localStorage.getItem('token');
      const user = localStorage.getItem('user');

      if (!token || !user) {
        // No auth, redirect to login
        localStorage.clear();
        router.push('/auth/login');
        return;
      }

      // Check if token is expired (JWT payload check)
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const expiryTime = payload.exp * 1000; // Convert to milliseconds
        
        if (Date.now() >= expiryTime) {
          // Token expired
          alert('Your session has expired. Please login again.');
          localStorage.clear();
          router.push('/auth/login');
        }
      } catch (error) {
        // Invalid token
        localStorage.clear();
        router.push('/auth/login');
      }
    };

    checkAuth();

    // Check every minute
    const interval = setInterval(checkAuth, 60000);

    return () => clearInterval(interval);
  }, [router, pathname]);
}