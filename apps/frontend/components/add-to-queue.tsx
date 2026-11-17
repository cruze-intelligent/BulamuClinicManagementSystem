'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Clock, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  createAppointmentOffline, getCurrentUser, listLocalAppointments, subscribeToLocalChanges, updateAppointmentOffline, type LocalAppointment,
} from '@/lib/local-first';
import { steppedOut, waitingQueue } from '@/lib/queue';
import { formatDate, formatTime, kampalaDay, serverNow, serverNowIso } from '@/lib/time';
import { activeDepartments, defaultDepartmentId, departmentName, knownDepartments, type Department } from '@/lib/departments';
import { useAuth } from '@/lib/useAuth';

/**
 * Puts a patient in today's waiting queue from wherever staff are: checks them
 * in for their appointment (today's, or one booked for another day they came
 * in for), or adds them as a walk-in - in the unit they are here for.
 */
export function AddToQueue({ patient }: { patient: { id: string; name: string; clinicId: string } }) {
  const { hasRole } = useAuth();
  const canReceive = hasRole('STAFF', 'NURSE', 'DOCTOR', 'ADMIN');
  const [appointments, setAppointments] = useState<LocalAppointment[]>([]);
  const [units, setUnits] = useState<Department[]>([]);
  // The unit chosen here; until then, the one booked into, or the usual one.
  const [picked, setUnit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    const load = () => listLocalAppointments(patient.clinicId).then((list) => setAppointments(list.filter((a) => a.patientId === patient.id))).catch(() => undefined);
    void load();
    const active = activeDepartments(patient.clinicId);
    setUnits(active);
    return subscribeToLocalChanges(() => { void load(); });
  }, [patient.id, patient.clinicId]);

  const now = serverNow();
  const waiting = waitingQueue(appointments, now)[0];
  const away = steppedOut(appointments, now)[0];
  // The appointment they are most likely here for: today's, else the nearest one still open.
  const open = appointments
    .filter((a) => a.status === 'SCHEDULED' && !a.checkedInAt)
    .sort((a, b) => Math.abs(new Date(a.date).getTime() - now.getTime()) - Math.abs(new Date(b.date).getTime() - now.getTime()));
  const booked = open.find((a) => kampalaDay(a.date) === kampalaDay(now)) ?? open[0];
  const hasUnits = units.length > 0;
  const unitName = (id: string | null | undefined) => departmentName(knownDepartments(patient.clinicId), id);
  const bookedUnit = booked?.departmentId && units.some((u) => u.id === booked.departmentId) ? booked.departmentId : null;
  const unit = picked ?? bookedUnit ?? defaultDepartmentId(units);

  if (!canReceive) return null;

  const run = async (work: () => Promise<unknown>) => {
    if (hasUnits && !unit) return setProblem('Choose the unit the patient is here for');
    setBusy(true);
    setProblem('');
    try {
      await work();
    } catch (error: any) {
      setProblem(error.message);
    } finally {
      setBusy(false);
    }
  };

  const checkIn = (appointment: LocalAppointment) => run(() => {
    const arrived = serverNowIso();
    // Came on another day than booked: the visit is today.
    const sameDay = kampalaDay(appointment.date) === kampalaDay(now);
    return updateAppointmentOffline(appointment, {
      checkedInAt: arrived,
      ...(sameDay ? {} : { date: arrived, time: formatTime(now) }),
      ...(hasUnits ? { departmentId: unit || null } : {}),
    });
  });

  const addWalkIn = () => run(() => {
    const user = getCurrentUser();
    return createAppointmentOffline({
      patientId: patient.id, doctorId: user.id || '', clinicId: patient.clinicId, date: now.toISOString(), time: formatTime(now),
      notes: 'Walk-in', patientName: patient.name, doctorName: user.name, checkedInAt: now.toISOString(), departmentId: hasUnits ? unit : null,
    });
  });

  if (away) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-amber-800 dark:text-amber-300" data-testid="add-to-queue">
        <Clock className="size-4" aria-hidden="true" />
        Stepped out of the waiting room at {formatTime(away.awayAt!)} - they keep their place for when they return.
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void updateAppointmentOffline(away, { awayAt: null }).catch((e) => setProblem(e.message))}>Back in the queue</Button>
      </p>
    );
  }

  if (waiting) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-emerald-800 dark:text-emerald-300" data-testid="add-to-queue">
        <Clock className="size-4" aria-hidden="true" />
        In the waiting room{unitName(waiting.departmentId) ? ` for ${unitName(waiting.departmentId)}` : ''} since {formatTime(waiting.checkedInAt!)}.
        <Link href="/consultations" className="font-medium underline">See the queue</Link>
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="add-to-queue">
      {hasUnits && (
        <div className="min-w-[11rem]">
          <Label htmlFor={`queue-unit-${patient.id}`} className="text-xs">Unit</Label>
          <Select id={`queue-unit-${patient.id}`} className="mt-1 h-9 py-0 text-sm" value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="">Choose the unit</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </div>
      )}
      {booked ? (
        <Button size="sm" className="h-auto min-h-8 max-w-full whitespace-normal py-1.5 text-left" disabled={busy} onClick={() => void checkIn(booked)}>
          <LogIn className="size-4" aria-hidden="true" />
          {kampalaDay(booked.date) === kampalaDay(now) ? `Check in for the ${booked.time} appointment` : `Check in now (booked for ${formatDate(booked.date)})`}
        </Button>
      ) : null}
      <Button size="sm" className="h-auto min-h-8 max-w-full whitespace-normal py-1.5 text-left" variant={booked ? 'outline' : 'default'} disabled={busy} onClick={() => void addWalkIn()}>
        <Clock className="size-4" aria-hidden="true" /> {booked ? 'Add as a walk-in instead' : 'Add to the waiting queue'}
      </Button>
      {problem && <p role="alert" className="w-full text-sm text-rose-700 dark:text-rose-400">{problem}</p>}
    </div>
  );
}
