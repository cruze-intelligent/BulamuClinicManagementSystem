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
import { formatTime, serverNow, serverNowIso } from '@/lib/time';
import { activeDepartments, defaultDepartmentId, departmentName, knownDepartments, myDepartmentIds, type Department } from '@/lib/departments';

const ALL = 'all';
const UNIT_KEY = 'waitingRoomUnit';

function rememberedUnit(units: Department[], mine: string[]): string {
  try {
    const saved = localStorage.getItem(UNIT_KEY);
    if (saved === ALL || (saved && units.some((u) => u.id === saved))) return saved;
  } catch {
    // Storage blocked: fall through to the person's own unit.
  }
  return units.find((u) => mine.includes(u.id))?.id ?? ALL;
}

/**
 * Today's waiting room: patients are seen in the order they arrived. Reception
 * checks booked patients in as they arrive and adds walk-ins; clinicians take
 * the next patient from the top. A facility with units (General OPD,
 * Dentistry...) has a queue for each; staff see their own unit's first.
 * Works offline, like the rest of the visit.
 */
export function WaitingRoom() {
  const { hasRole } = useAuth();
  const canSee = hasRole('DOCTOR', 'NURSE', 'ADMIN');
  const canReceive = hasRole('STAFF', 'NURSE', 'DOCTOR', 'ADMIN');
  const [appointments, setAppointments] = useState<LocalAppointment[]>([]);
  const [patients, setPatients] = useState<LocalPatient[]>([]);
  const [units, setUnits] = useState<Department[]>([]);
  const [allUnits, setAllUnits] = useState<Department[]>([]);
  const [unit, setUnit] = useState(ALL);
  const [walkIn, setWalkIn] = useState('');
  const [walkInUnit, setWalkInUnit] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [now, setNow] = useState(() => serverNow());

  const load = async () => {
    const clinicId = getCurrentClinicId();
    if (!clinicId) return;
    const [a, p] = await Promise.all([listLocalAppointments(clinicId), listLocalPatients(clinicId)]);
    setAppointments(a);
    setPatients(p);
    setNow(serverNow());
  };

  const loadUnits = () => {
    const clinicId = getCurrentClinicId();
    const active = activeDepartments(clinicId);
    setUnits(active);
    setAllUnits(knownDepartments(clinicId));
    setUnit((current) => (current === ALL || active.some((u) => u.id === current) ? rememberedUnit(active, myDepartmentIds()) : ALL));
  };

  useEffect(() => {
    void load();
    loadUnits();
    const unsubscribe = subscribeToLocalChanges(load);
    window.addEventListener('bulamu:departments', loadUnits);
    // Waiting times move on by themselves.
    const timer = setInterval(() => setNow(serverNow()), 60_000);
    return () => { unsubscribe(); window.removeEventListener('bulamu:departments', loadUnits); clearInterval(timer); };
  }, []);

  const chooseUnit = (id: string) => {
    setUnit(id);
    try { localStorage.setItem(UNIT_KEY, id); } catch { /* remembered for this visit only */ }
  };

  const hasUnits = units.length > 0;
  const inUnit = (a: LocalAppointment) => !hasUnits || unit === ALL || a.departmentId === unit;
  const byId = useMemo(() => new Map(patients.map((p) => [p.id, p])), [patients]);
  const everyone = waitingQueue(appointments, now);
  const queue = everyone.filter(inUnit);
  const expected = expectedToday(appointments, now).filter(inUnit);
  const nameOf = (a: LocalAppointment) => a.patient?.name ?? byId.get(a.patientId)?.name ?? 'Patient';
  const idOf = (a: LocalAppointment) => patientIdText(byId.get(a.patientId)?.patientNumber);
  const unitOf = (a: LocalAppointment) => departmentName(allUnits, a.departmentId);
  const waitingIds = new Set(everyone.map((a) => a.patientId));
  const waitingIn = (id: string) => everyone.filter((a) => a.departmentId === id).length;
  const walkInUnitId = walkInUnit || (unit !== ALL ? unit : defaultDepartmentId(units));
  const unitHere = unit === ALL ? null : units.find((u) => u.id === unit);

  const checkIn = async (appointment: LocalAppointment) => {
    setProblem('');
    try {
      await updateAppointmentOffline(appointment, {
        checkedInAt: serverNowIso(),
        // Booked without a unit: they wait in the one on screen, or the usual one.
        ...(hasUnits && !appointment.departmentId ? { departmentId: (unit !== ALL ? unit : defaultDepartmentId(units)) || null } : {}),
      });
    } catch (error: any) {
      setProblem(error.message);
    }
  };

  // Sent to the wrong queue: moved, keeping their place by arrival time.
  const moveTo = async (appointment: LocalAppointment, departmentId: string) => {
    if (!departmentId || departmentId === appointment.departmentId) return;
    setProblem('');
    try {
      await updateAppointmentOffline(appointment, { departmentId });
    } catch (error: any) {
      setProblem(error.message);
    }
  };

  const addWalkIn = async (event: React.FormEvent) => {
    event.preventDefault();
    const patient = byId.get(walkIn);
    if (!patient) return setProblem('Choose the patient who has arrived');
    if (waitingIds.has(patient.id)) return setProblem(`${patient.name} is already waiting`);
    if (hasUnits && !walkInUnitId) return setProblem('Choose the unit the patient is here for');
    setBusy(true);
    setProblem('');
    try {
      const user = getCurrentUser();
      const arrived = serverNow();
      await createAppointmentOffline({
        patientId: patient.id, doctorId: user.id || '', clinicId: patient.clinicId, date: arrived.toISOString(),
        time: formatTime(arrived), notes: 'Walk-in',
        patientName: patient.name, doctorName: user.name, checkedInAt: arrived.toISOString(),
        departmentId: hasUnits ? walkInUnitId : null,
      });
      setWalkIn('');
      setWalkInUnit('');
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
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Waiting room{unitHere ? ` - ${unitHere.name}` : ''} ({queue.length})
          </h2>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">Seen in the order they arrived.</p>
      </div>

      {hasUnits && (
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Unit">
          {[{ id: ALL, name: 'All units', count: everyone.length }, ...units.map((u) => ({ id: u.id, name: u.name, count: waitingIn(u.id) }))].map((u) => (
            <button
              key={u.id}
              type="button"
              aria-pressed={unit === u.id}
              onClick={() => chooseUnit(u.id)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${unit === u.id ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-slate-300 text-slate-700 hover:border-emerald-600 dark:border-slate-700 dark:text-slate-300'}`}
            >
              {u.name} <span className={unit === u.id ? 'text-emerald-100' : 'text-slate-500'}>{u.count}</span>
            </button>
          ))}
        </div>
      )}

      {queue.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          Nobody is waiting{unitHere ? ` in ${unitHere.name}` : ''}. Check patients in as they arrive{canReceive ? ', or add a walk-in below' : ''}.
        </p>
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
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {waitingText(a.checkedInAt!, now)}
                  {hasUnits && unit === ALL ? ` - ${unitOf(a) ?? 'No unit given'}` : ''}
                  {a.notes ? ` - ${a.notes}` : ''}
                </p>
              </div>
              {hasUnits && canReceive && (
                <div>
                  <Label htmlFor={`move-${a.id}`} className="sr-only">Send {nameOf(a)} to another unit</Label>
                  <Select id={`move-${a.id}`} className="h-8 py-0 text-xs" value="" onChange={(e) => void moveTo(a, e.target.value)}>
                    <option value="">Send to...</option>
                    {units.filter((u) => u.id !== a.departmentId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </Select>
                </div>
              )}
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
                <span>
                  {nameOf(a)} <span className="text-xs text-slate-500">at {a.time}{hasUnits && unit === ALL && unitOf(a) ? ` - ${unitOf(a)}` : ''}</span>
                </span>
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
          {hasUnits && (
            <div className="min-w-[10rem]">
              <Label htmlFor="walk-in-unit" className="text-sm">Unit</Label>
              <Select id="walk-in-unit" className="mt-1" value={walkInUnitId} onChange={(e) => setWalkInUnit(e.target.value)}>
                <option value="">Choose the unit</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </div>
          )}
          <Button type="submit" variant="outline" disabled={busy}><UserPlus className="size-4" aria-hidden="true" /> {busy ? 'Adding...' : 'Add to queue'}</Button>
        </form>
      )}
      {problem && <p role="alert" className="mt-2 text-sm text-rose-700 dark:text-rose-400">{problem}</p>}
    </Card>
  );
}
