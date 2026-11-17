// The waiting queue: patients who have arrived today and not yet been seen,
// first come, first seen. Arrival is when reception checked them in (or added
// them as a walk-in); being seen is a visit recorded for the appointment.

export type QueueAppointment = {
  id: string;
  patientId: string;
  status: string;
  date: string;
  checkedInAt?: string | null;
  patient?: { name: string; phone?: string } | null;
  doctor?: { name: string } | null;
  doctorId?: string;
};

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Today's arrivals still waiting, in the order they arrived. */
export function waitingQueue<T extends QueueAppointment>(appointments: T[], now: Date = new Date()): T[] {
  return appointments
    .filter((a) => a.status === 'SCHEDULED' && a.checkedInAt && sameDay(new Date(a.checkedInAt), now))
    .sort((a, b) => new Date(a.checkedInAt!).getTime() - new Date(b.checkedInAt!).getTime());
}

/** Today's appointments that are booked but have not arrived yet - reception checks them in. */
export function expectedToday<T extends QueueAppointment>(appointments: T[], now: Date = new Date()): T[] {
  return appointments.filter((a) => a.status === 'SCHEDULED' && !a.checkedInAt && sameDay(new Date(a.date), now));
}

/** "Arrived 09:12 - waiting 25 min" / "waiting 1 h 40 min". */
export function waitingText(checkedInAt: string, now: Date = new Date()): string {
  const arrived = new Date(checkedInAt);
  const minutes = Math.max(0, Math.round((now.getTime() - arrived.getTime()) / 60000));
  const time = arrived.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const waited = minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
  return `Arrived ${time} - waiting ${waited}`;
}
