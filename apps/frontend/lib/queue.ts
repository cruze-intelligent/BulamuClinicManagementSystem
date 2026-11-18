import { formatTime, kampalaDay, serverNow } from './time';

// The waiting queue: patients who have arrived today and not yet been seen,
// first come, first seen. Arrival is when reception checked them in (or added
// them as a walk-in); being seen is a visit recorded for the appointment.

export type QueueAppointment = {
  id: string;
  patientId: string;
  status: string;
  date: string;
  checkedInAt?: string | null;
  /** Stepped out for a while: off the queue, keeping their place by arrival time. */
  awayAt?: string | null;
  /** The unit whose queue it is in (empty: the facility works as one queue). */
  departmentId?: string | null;
  patient?: { name: string; phone?: string } | null;
  doctor?: { name: string } | null;
  doctorId?: string;
};

// "Today" is the Kampala day, whatever time zone the device is set to.
const sameDay = (a: Date, b: Date) => kampalaDay(a) === kampalaDay(b);

const sameUnit = (a: QueueAppointment, b: QueueAppointment) => !a.departmentId || !b.departmentId || a.departmentId === b.departmentId;
const seenAt = (a: QueueAppointment) => new Date(a.checkedInAt ?? a.date).getTime();

/**
 * Already seen in this unit since arriving: a visit was recorded for the patient
 * on another entry (a walk-in made by recording the visit outside the queue).
 * Such an entry leaves the queue - a patient is never left waiting after being seen.
 */
export function seenSinceArriving<T extends QueueAppointment>(entry: T, appointments: T[]): boolean {
  if (!entry.checkedInAt) return false;
  const arrived = new Date(entry.checkedInAt).getTime();
  return appointments.some((other) =>
    other.id !== entry.id && other.patientId === entry.patientId && other.status === 'COMPLETED' && sameUnit(entry, other)
    && seenAt(other) >= arrived && sameDay(new Date(seenAt(other)), new Date(arrived)));
}

/** Today's arrivals not yet seen, in the order they arrived - those here and those stepped out. */
function arrivedToday<T extends QueueAppointment>(appointments: T[], now: Date): T[] {
  return appointments
    .filter((a) => a.status === 'SCHEDULED' && a.checkedInAt && sameDay(new Date(a.checkedInAt), now) && !seenSinceArriving(a, appointments))
    .sort((a, b) => new Date(a.checkedInAt!).getTime() - new Date(b.checkedInAt!).getTime());
}

/**
 * The patient's open visit today - the queue entry a visit recorded for them
 * should complete, rather than making a second one: in the visit's unit if it
 * has one, those who have arrived first, the earliest arrival first.
 */
export function openVisitToday<T extends QueueAppointment>(appointments: T[], patientId: string, departmentId?: string | null, now: Date = serverNow()): T | null {
  const open = appointments
    .filter((a) => a.patientId === patientId && a.status === 'SCHEDULED' && sameDay(new Date(a.checkedInAt ?? a.date), now) && !seenSinceArriving(a, appointments))
    .filter((a) => !departmentId || !a.departmentId || a.departmentId === departmentId)
    .sort((a, b) => Number(!a.checkedInAt) - Number(!b.checkedInAt) || seenAt(a) - seenAt(b));
  return open[0] ?? null;
}

/** Today's arrivals still waiting, in the order they arrived. */
export function waitingQueue<T extends QueueAppointment>(appointments: T[], now: Date = serverNow()): T[] {
  return arrivedToday(appointments, now).filter((a) => !a.awayAt);
}

/** Those who stepped out for a while: back in their place, by arrival time, when they return. */
export function steppedOut<T extends QueueAppointment>(appointments: T[], now: Date = serverNow()): T[] {
  return arrivedToday(appointments, now).filter((a) => !!a.awayAt);
}

/** Today's appointments that are booked but have not arrived yet - reception checks them in. */
export function expectedToday<T extends QueueAppointment>(appointments: T[], now: Date = serverNow()): T[] {
  return appointments.filter((a) => a.status === 'SCHEDULED' && !a.checkedInAt && sameDay(new Date(a.date), now));
}

/** "Arrived 09:12 - waiting 25 min" / "waiting 1 h 40 min". */
export function waitingText(checkedInAt: string, now: Date = serverNow()): string {
  const arrived = new Date(checkedInAt);
  const minutes = Math.max(0, Math.round((now.getTime() - arrived.getTime()) / 60000));
  const time = formatTime(arrived);
  const waited = minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
  return `Arrived ${time} - waiting ${waited}`;
}
