'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // If user is logged in, redirect to dashboard
    const user = localStorage.getItem('user');
    if (user) {
      router.push('/dashboard');
    }
  }, [router]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-slate-100">
      <div className="text-center max-w-2xl px-8">
        <h1 className="text-6xl font-bold mb-4">Bulamu 🏥</h1>
        <p className="text-2xl text-muted-foreground mb-2">Your clinic, digitized</p>
        <p className="text-lg text-slate-600 mb-8">
          Modern clinic management for Uganda. Patient records, appointments, consultations & billing - all in one place.
        </p>
        
        <div className="flex gap-4 justify-center">
          <Link href="/auth/login">
            <Button size="lg" className="text-lg px-8">
              Sign In
            </Button>
          </Link>
          <Link href="/auth/login">
            <Button size="lg" variant="outline" className="text-lg px-8">
              Request Demo
            </Button>
          </Link>
        </div>

        <div className="mt-12 grid grid-cols-3 gap-6 text-left">
          <div className="p-4 bg-white rounded-lg shadow-sm">
            <p className="text-3xl mb-2">📋</p>
            <h3 className="font-semibold mb-1">Patient Records</h3>
            <p className="text-sm text-muted-foreground">Digital medical history</p>
          </div>
          <div className="p-4 bg-white rounded-lg shadow-sm">
            <p className="text-3xl mb-2">📅</p>
            <h3 className="font-semibold mb-1">Appointments</h3>
            <p className="text-sm text-muted-foreground">Easy scheduling</p>
          </div>
          <div className="p-4 bg-white rounded-lg shadow-sm">
            <p className="text-3xl mb-2">💰</p>
            <h3 className="font-semibold mb-1">Billing</h3>
            <p className="text-sm text-muted-foreground">Automated invoices</p>
          </div>
        </div>
      </div>
    </main>
  );
}