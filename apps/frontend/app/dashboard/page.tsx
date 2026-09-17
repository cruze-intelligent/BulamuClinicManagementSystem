'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { PatientSearch } from '@/components/patient-search';
import { useAuth } from '@/lib/useAuth';

export default function Dashboard() {
  const [stats, setStats] = useState<any>(null);
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const { hasRole } = useAuth();

  useEffect(() => {
    fetchDashboard();
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
        setAppointments(data.todayAppointments);
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
    <div className="min-h-screen p-8 bg-slate-50 dark:bg-slate-950">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Dashboard</h1>
        
        {/* Search */}
        <div className="mb-6">
          <PatientSearch />
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-4 mb-8 sm:grid-cols-4">
          <Card className="p-6">
            <h3 className="text-sm text-muted-foreground">Total Patients</h3>
            <p className="text-3xl font-bold">{stats.totalPatients}</p>
          </Card>
          <Card className="p-6">
            <h3 className="text-sm text-muted-foreground">Today's Appointments</h3>
            <p className="text-3xl font-bold">{stats.todayAppointments}</p>
          </Card>
          {hasRole('ADMIN', 'DOCTOR') && (
            <Card className="p-6">
              <h3 className="text-sm text-muted-foreground">Pending Invoices</h3>
              <p className="text-3xl font-bold">{stats.pendingInvoices}</p>
            </Card>
          )}
          {hasRole('ADMIN') && (
            <Card className="p-6">
              <h3 className="text-sm text-muted-foreground">Total Revenue</h3>
              <p className="text-3xl font-bold">UGX {stats.totalRevenue.toLocaleString()}</p>
            </Card>
          )}
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 gap-4 mb-8 sm:grid-cols-3">
          {hasRole('ADMIN', 'DOCTOR', 'NURSE', 'STAFF') && (
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
        </div>

        {/* Today's Appointments */}
        <h2 className="text-xl font-bold mb-4">Today's Appointments</h2>
        <div className="space-y-3">
          {appointments.map((apt: any) => (
            <Card key={apt.id} className="p-4 flex justify-between items-center">
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