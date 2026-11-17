'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Clock, LogIn, UserPlus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  createAppointmentOffline, getCurrentClinicId, getCurrentUser, listLocalAppointments, listLocalPatients, subscribeToLocalChanges,
  updateAppointmentOffline, type LocalAppointment, type LocalPatient,
} from '@/lib/local-first';
import { expectedToday, waitingQueue, waitingText } from '@/lib/queue';
import { patientIdText } from '@/lib/patient-id';
import { useAuth } from '@/lib/useAuth';

/**
 * Today's waiting room: patients are seen in the order they arrived. Reception
 * checks booked patients in as they arrive and adds walk-ins; clinicians take
 * the next patient from the top. Works offline, like the rest of the visit.
 */
export function WaitingRoom() {
  const { hasRole } = useAuth();
  const canSee = hasRole('DOCTOR', 'NURSE', 'ADMIN');
  const canReceive = hasRole('STAFF', 'NURSE', 'DOCTOR', 'ADMIN');
  const [appointments, setAppointments] = useState<LocalAppointment[]>([]);
  const [patients, setPatients] = useState<LocalPatient[]>([]);
  const [walkIn, setWalkIn] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [now, setNow] = useState(() => new Date());

  const load = async () => {
    const clinicId = getCurrentClinicId();
    if (!clinicId) return;
    const [a, p] = await Promise.all([listLocalAppointments(clinicId), listLocalPatients(clinicId)]);
    setAppointments(a);
    setPatients(p);
    setNow(new Date());
  };

  useEffect(() => {
    void load();
    const unsubscribe = subscribeToLocalChanges(load);
    // Waiting times move on by themselves.
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => { unsubscribe(); clearInterval(timer); };
  }, []);

  const byId = useMemo(() => new Map(patients.map((p) => [p.id, p])), [patients]);
  const queue = waitingQueue(appointments, now);
  const expected = expectedToday(appointments, now);
  const nameOf = (a: LocalAppointment) => a.patient?.name ?? byId.get(a.patientId)?.name ?? 'Patient';
  const idOf = (a: LocalAppointment) => patientIdText(byId.get(a.patientId)?.patientNumber);
  const waitingIds = new Set(queue.map((a) => a.patientId));

  const checkIn = async (appointment: LocalAppointment) => {
    setProblem('');
    try {
      await updateAppointmentOffline(appointment, { checkedInAt: new Date().toISOString() });
    } catch (error: any) {
      setProblem(error.message);
    }
  };

  const addWalkIn = async (event: React.FormEvent) => {
    event.preventDefault();
    const patient = byId.get(walkIn);
    if (!patient) return setProblem('Choose the patient who has arrived');
    if (waitingIds.has(patient.id)) return setProblem(`${patient.name} is already waiting`);
    setBusy(true);
    setProblem('');
    try {
      const user = getCurrentUser();
      const arrived = new Date();
      await createAppointmentOffline({
        patientId: patient.id, doctorId: user.id || '', clinicId: patient.clinicId, date: arrived.toISOString(),
        time: arrived.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), notes: 'Walk-in',
        patientName: patient.name, doctorName: user.name, checkedInAt: arrived.toISOString(),
      });
      setWalkIn('');
    } catch (error: any) {
      setProblem(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-6 p-5" data-testid="waiting-room">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Clock className="size-5 text-emerald-700" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Waiting room ({queue.length})</h2>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">Seen in the order they arrived.</p>
      </div>

      {queue.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Nobody is waiting. Check patients in as they arrive{canReceive ? ', or add a walk-in below' : ''}.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {queue.map((a, i) => (
            <li key={a.id} className={`flex flex-wrap items-center gap-3 rounded-md border p-3 ${i === 0 ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30' : 'border-slate-200 dark:border-slate-800'}`}>
              <span className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${i === 0 ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900 dark:text-slate-100">
                  {nameOf(a)} {idOf(a) && <span className="ml-1 font-mono text-xs font-normal text-slate-500">ID {idOf(a)}</span>}
                  {i === 0 && <span className="ml-2 rounded-full bg-emerald-700 px-2 py-0.5 text-[11px] font-semibold text-white">Next</span>}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{waitingText(a.checkedInAt!, now)}{a.notes ? ` - ${a.notes}` : ''}</p>
              </div>
              {canSee && (
                <Link href={`/consultations/record?appointmentId=${a.id}&patientId=${a.patientId}`}>
                  <Button size="sm" variant={i === 0 ? 'default' : 'outline'}>Start visit</Button>
                </Link>
              )}
            </li>
          ))}
        </ol>
      )}

      {canReceive && expected.length > 0 && (
        <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-800">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Booked for today, not arrived yet</p>
          <ul className="mt-2 space-y-1.5">
            {expected.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{nameOf(a)} <span className="text-xs text-slate-500">at {a.time}</span></span>
                <Button size="sm" variant="outline" onClick={() => checkIn(a)}><LogIn className="size-4" aria-hidden="true" /> Check in</Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canReceive && (
        <form onSubmit={addWalkIn} className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
          <div className="min-w-[14rem] flex-1">
            <Label htmlFor="walk-in" className="text-sm">Add a walk-in to the queue</Label>
            <Select id="walk-in" className="mt-1" value={walkIn} onChange={(e) => setWalkIn(e.target.value)}>
              <option value="">Choose the patient (register new patients first)</option>
              {patients.filter((p) => !waitingIds.has(p.id)).map((p) => (
                <option key={p.id} value={p.id}>{p.name}{patientIdText(p.patientNumber) ? ` - ID ${patientIdText(p.patientNumber)}` : ''} - {p.phone}</option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="outline" disabled={busy}><UserPlus className="size-4" aria-hidden="true" /> {busy ? 'Adding...' : 'Add to queue'}</Button>
        </form>
      )}
      {problem && <p role="alert" className="mt-2 text-sm text-rose-700 dark:text-rose-400">{problem}</p>}
    </Card>
  );
}
