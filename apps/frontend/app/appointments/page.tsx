'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function AppointmentsPage() {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAppointments();
  }, []);

  const fetchAppointments = async () => {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/appointments/${user.clinicId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const data = await response.json();
      if (data.success) setAppointments(data.appointments);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    const token = localStorage.getItem('token');

    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/appointments/${id}`, {
      method: 'PATCH',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ status })
    });

    fetchAppointments();
  };

  return (
    <div className="min-h-screen p-8 bg-slate-50">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Appointments</h1>
          <Link href="/appointments/book">
            <Button>+ Book Appointment</Button>
          </Link>
        </div>

        {loading ? (
          <p>Loading...</p>
        ) : (
          <div className="space-y-3">
            {appointments.map((apt: any) => (
              <Card key={apt.id} className="p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-semibold">{apt.patient.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {new Date(apt.date).toLocaleDateString()} at {apt.time}
                    </p>
                    <p className="text-sm">Dr. {apt.doctor.name}</p>
                    {apt.notes && <p className="text-sm mt-1">{apt.notes}</p>}
                  </div>
                  <div className="flex gap-2">
                    {apt.status === 'SCHEDULED' && (
                      <>
                        <Link href={`/consultations/record?appointmentId=${apt.id}`}>
                          <Button size="sm">Record</Button>
                        </Link>
                        <Button size="sm" onClick={() => updateStatus(apt.id, 'COMPLETED')}>Complete</Button>
                        <Button size="sm" variant="destructive" onClick={() => updateStatus(apt.id, 'CANCELLED')}>Cancel</Button>
                      </>
                    )}
                    <span className={`text-xs px-2 py-1 rounded ${
                      apt.status === 'COMPLETED' ? 'bg-green-100' : 
                      apt.status === 'CANCELLED' ? 'bg-red-100' : 'bg-blue-100'
                    }`}>
                      {apt.status}
                    </span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}