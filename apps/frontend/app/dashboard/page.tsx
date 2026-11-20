'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { PatientSearch } from '@/components/patient-search';
import { useAuth } from '@/lib/useAuth';
import { Stat } from '@/components/report-parts';
import { ALWAYS_SHOWN, menuFor } from '@/lib/nav-items';
import { useRouter } from 'next/navigation';

export default function Dashboard() {
  const [stats, setStats] = useState<any>(null);
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const { hasRole, user } = useAuth();
  // A tile for each part of Bulamu this person works in (their menu, less what is always there).
  const sections = user ? menuFor([user.role, ...(Array.isArray(user.extraRoles) ? user.extraRoles : [])], Array.isArray(user.hiddenSections) ? user.hiddenSections : []).filter((item) => !ALWAYS_SHOWN.includes(item.path) && item.path !== '/sync-activity') : [];
  const router = useRouter();

  useEffect(() => {
    // The installed app opens here; the platform administrator's start page is
    // Facility Management (a facility dashboard would only load HQ's figures).
    if (hasRole('SUPER_ADMIN')) {
      router.replace('/super-admin');
      return;
    }
    fetchDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchDashboard = async () => {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    if (!token || !user.clinicId) {
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/dashboard/${user.clinicId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const data = await response.json();
      if (data.success) {
        setStats(data.stats);
        setAppointments(data.todayAppointments ?? []);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="p-8">Loading...</div>;
  if (!stats) return <div className="p-8 text-slate-500 dark:text-slate-400">Unable to load dashboard data. Try refreshing.</div>;

  return (
    <div className="min-h-screen p-4 sm:p-8 bg-slate-50 dark:bg-slate-950">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Dashboard</h1>
        
        {/* Search */}
        <div className="mb-6">
          <PatientSearch />
        </div>

        {/* Stats Grid */}
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Patients" value={stats.totalPatients} />
          <Stat label="Today's appointments" value={stats.todayAppointments} />
          {hasRole('ADMIN', 'DOCTOR') && <Stat label="Bills still owed" value={stats.pendingInvoices} />}
          {hasRole('ADMIN') && <Stat label="Received from patients, all time (UGX)" value={Math.round(stats.totalRevenue)} tone="good" />}
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 gap-4 mb-8 sm:grid-cols-3">
          {hasRole('ADMIN', 'DOCTOR', 'NURSE', 'STAFF', 'LAB_TECH') && (
            <Link href="/patients/register">
              <Button className="w-full">+ Register Patient</Button>
            </Link>
          )}
          {hasRole('ADMIN', 'DOCTOR') && (
            <Link href="/appointments/book">
              <Button className="w-full">+ Book Appointment</Button>
            </Link>
          )}
          <Link href="/patients">
            <Button className="w-full" variant="outline">View Patients</Button>
          </Link>
          {hasRole('ADMIN') && (
            <Link href="/users" title="Give each person their role, the units they work in, and any other roles they also do">
              <Button className="w-full" variant="outline">Staff roles, units and duties</Button>
            </Link>
          )}
        </div>

        {/* The parts of Bulamu this person works in */}
        {sections.length > 0 && (
          <section aria-labelledby="sections-title" className="mb-8">
            <h2 id="sections-title" className="mb-3 text-xl font-bold">Your work</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {sections.map((item) => (
                <Link key={item.path} href={item.path} className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-medium text-slate-800 transition-colors hover:border-emerald-600 hover:text-emerald-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:text-emerald-400">
                  <item.icon className="size-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                  <span className="truncate">{item.name}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Today's Appointments */}
        <h2 className="text-xl font-bold mb-4">Today's Appointments</h2>
        <div className="space-y-3">
          {appointments.map((apt: any) => (
            <Card key={apt.id} className="flex-row items-center justify-between gap-3 p-4">
              <div>
                <h3 className="font-semibold">{apt.patient.name}</h3>
                <p className="text-sm text-muted-foreground">{apt.time} • Dr. {apt.doctor.name}</p>
              </div>
              <span className="text-xs px-2 py-1 rounded bg-blue-100">{apt.status}</span>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}