'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Link from 'next/link';
import { WaitingRoom } from '@/components/waiting-room';
import {
  listLocalAppointments,
  cacheAppointments,
  getCurrentClinicId,
  getCurrentUser,
  subscribeToLocalChanges,
  updateAppointmentOffline,
  LocalAppointment,
} from '@/lib/local-first';
import { formatDate, formatTime, kampalaDay, serverNow, serverNowIso } from '@/lib/time';
import { activeDepartments, defaultDepartmentId, departmentName, knownDepartments } from '@/lib/departments';

type AppointmentRequest = {
  id: string;
  preferredDate: string;
  preferredTime: string | null;
  reason: string | null;
  status: string;
  patient: { id: string; name: string; phone: string };
};

export default function AppointmentsPage() {
  const [appointments, setAppointments] = useState<LocalAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<AppointmentRequest[]>([]);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [responseDate, setResponseDate] = useState('');
  const [responseTime, setResponseTime] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadRequests = async () => {
    const clinicId = getCurrentClinicId();
    if (!clinicId || !navigator.onLine) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/appointment-requests/${clinicId}?status=PENDING`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) setRequests(data.requests);
    } catch (err) {
      console.warn('Appointment requests fetch failed:', err);
    }
  };

  const startResponding = (request: AppointmentRequest) => {
    setRespondingTo(request.id);
    setResponseDate(request.preferredDate.slice(0, 10));
    setResponseTime(request.preferredTime || '');
  };

  const handleAccept = async (requestId: string) => {
    if (!responseDate || !responseTime) {
      alert('Please confirm a date and time');
      return;
    }
    const user = getCurrentUser();
    setSubmitting(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/appointment-requests/${requestId}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ doctorId: user.id, date: responseDate, time: responseTime }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Could not accept request');
      setRespondingTo(null);
      await Promise.all([loadRequests(), refreshFromServer()]);
    } catch (error: any) {
      alert(`Error accepting request: ${error.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecline = async (requestId: string) => {
    if (!confirm('Decline this appointment request?')) return;
    setSubmitting(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/appointment-requests/${requestId}/decline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Could not decline request');
      await loadRequests();
    } catch (error: any) {
      alert(`Error declining request: ${error.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const loadAppointments = async () => {
    const clinicId = getCurrentClinicId();
    if (!clinicId) return;

    const localData = await listLocalAppointments(clinicId);
    setAppointments(localData);
    setLoading(false);
  };

  // The server's list when the page opens and when the connection returns - not on every
  // change here: saving it is a change, and the page used to ask again without end.
  const refreshFromServer = async () => {
    const clinicId = getCurrentClinicId();
    if (!clinicId || !navigator.onLine) return;
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/appointments/${clinicId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.appointments)) await cacheAppointments(data.appointments);
    } catch (err) {
      console.warn('Appointments fetch failed, using local records:', err);
    }
  };

  // The patient has arrived: they join the waiting queue, in their unit. Come on another day than booked, the visit is today.
  const checkIn = (apt: LocalAppointment) => {
    const now = serverNow();
    const sameDay = kampalaDay(apt.date) === kampalaDay(now);
    const units = activeDepartments(apt.clinicId);
    return updateAppointmentOffline(apt, {
      checkedInAt: serverNowIso(),
      ...(sameDay ? {} : { date: now.toISOString(), time: formatTime(now) }),
      ...(units.length > 0 && !apt.departmentId ? { departmentId: defaultDepartmentId(units) || null } : {}),
    });
  };

  useEffect(() => {
    loadAppointments();
    void refreshFromServer();
    loadRequests();
    const unsubscribe = subscribeToLocalChanges(loadAppointments);
    const online = () => void refreshFromServer();
    window.addEventListener('online', online);
    return () => { unsubscribe(); window.removeEventListener('online', online); };
  }, []);

  return (
    <div className="min-h-screen p-4 sm:p-8 bg-slate-50 dark:bg-slate-950">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-200">Appointments</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Today's patients and upcoming bookings</p>
          </div>
          <Link href="/appointments/book">
            <Button>+ Book Appointment</Button>
          </Link>
        </div>

        {/* Reception checks patients in here as they arrive, and adds walk-ins. */}
        <WaitingRoom />

        {requests.length > 0 && (
          <Card className="p-4 mb-6 border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
            <h2 className="font-semibold text-slate-800 dark:text-slate-200 mb-3">Patient-requested appointments ({requests.length})</h2>
            <div className="space-y-3">
              {requests.map((r) => (
                <div key={r.id} className="bg-white dark:bg-slate-900 rounded-md p-3">
                  <div className="flex justify-between items-start gap-3">
                    <div>
                      <p className="font-medium text-slate-800 dark:text-slate-200">{r.patient.name} ({r.patient.phone})</p>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Preferred: {formatDate(r.preferredDate)}{r.preferredTime ? ` at ${r.preferredTime}` : ''}
                      </p>
                      {r.reason && <p className="text-sm text-slate-500 dark:text-slate-400">Reason: {r.reason}</p>}
                    </div>
                    {respondingTo !== r.id && (
                      <div className="flex gap-2 shrink-0">
                        <Button size="sm" onClick={() => startResponding(r)}>Accept</Button>
                        <Button size="sm" variant="outline" disabled={submitting} onClick={() => handleDecline(r.id)}>Decline</Button>
                      </div>
                    )}
                  </div>
                  {respondingTo === r.id && (
                    <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
                      <div>
                        <Label htmlFor={`accept-date-${r.id}`} className="text-xs">Date</Label>
                        <Input id={`accept-date-${r.id}`} type="date" value={responseDate} onChange={(e) => setResponseDate(e.target.value)} />
                      </div>
                      <div>
                        <Label htmlFor={`accept-time-${r.id}`} className="text-xs">Time</Label>
                        <Input id={`accept-time-${r.id}`} type="time" value={responseTime} onChange={(e) => setResponseTime(e.target.value)} />
                      </div>
                      <Button size="sm" disabled={submitting} onClick={() => handleAccept(r.id)}>Confirm</Button>
                      <Button size="sm" variant="ghost" onClick={() => setRespondingTo(null)}>Cancel</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        {loading ? (
          <p className="text-slate-500 dark:text-slate-400">Loading appointments...</p>
        ) : appointments.length === 0 ? (
          <Card className="p-8 text-center text-slate-500 dark:text-slate-400">
            No appointments found. Click above to book an appointment (works offline).
          </Card>
        ) : (
          <div className="space-y-3">
            {appointments.map((apt) => (
              <Card key={apt.id} className="p-4">
                <div className="flex flex-wrap justify-between items-start gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-slate-800 dark:text-slate-200">{apt.patient?.name || 'Patient'}</h3>
                      {apt.syncStatus === 'pending' && (
                        <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-medium">
                          Pending Sync
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {formatDate(apt.date)} at {apt.time}
                      {departmentName(knownDepartments(apt.clinicId), apt.departmentId) ? ` - ${departmentName(knownDepartments(apt.clinicId), apt.departmentId)}` : ''}
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">Dr. {apt.doctor?.name || 'Assigned Clinician'}</p>
                    {apt.notes && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{apt.notes}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {apt.status === 'SCHEDULED' && !apt.checkedInAt && (
                      <Button size="sm" variant="outline" onClick={() => checkIn(apt).catch((e) => alert(e.message))}>
                        {kampalaDay(apt.date) === kampalaDay(serverNow()) ? 'Check in' : 'Check in now'}
                      </Button>
                    )}
                    {apt.status === 'SCHEDULED' && apt.checkedInAt && (
                      <span className="text-xs text-emerald-700 dark:text-emerald-400">Arrived {formatTime(apt.checkedInAt)} - in the waiting room</span>
                    )}
                    {apt.status === 'SCHEDULED' && (
                      <Link href={`/consultations/record?appointmentId=${apt.id}&patientId=${apt.patientId}`}>
                        <Button size="sm">Record Consultation</Button>
                      </Link>
                    )}
                    <span
                      className={`text-xs px-2.5 py-1 rounded font-medium ${
                        apt.status === 'COMPLETED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : apt.status === 'CANCELLED'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-blue-100 text-blue-800'
                      }`}
                    >
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