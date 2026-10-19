'use client';

import { useState } from 'react';
import { CalendarClock, CalendarPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { kampalaToday } from '@/lib/finance';
import { APPOINTMENT_STATES, appointmentDate, gather, portalDate, splitAppointments, type PortalRecord } from '@/lib/patient-portal';
import { EmptyState, FacilityTag, PortalCard, StateBadge, TabIntro } from './ui';

const REQUEST_STATES = {
  PENDING: { label: 'Waiting for the facility to confirm', tone: 'pending' },
  ACCEPTED: { label: 'Confirmed - see your appointments', tone: 'good' },
  DECLINED: { label: 'Not possible', tone: 'muted' },
  CANCELLED: { label: 'Cancelled', tone: 'muted' },
} as const;

/** Booked appointments, requests the patient has made, and a form to ask for one. */
export function PortalAppointments({ records, onChanged, onError }: { records: PortalRecord[]; onChanged: () => Promise<void>; onError: (message: string) => void }) {
  const several = records.length > 1;
  const { upcoming, past } = splitAppointments(records);
  // Requests still open, and recent answers (a decline says why).
  const requests = gather(records, (r) => r.appointmentRequests, (q) => q.createdAt).filter((q) => q.status === 'PENDING' || q.status === 'DECLINED').slice(0, 6);

  const [open, setOpen] = useState(false);
  const [recordId, setRecordId] = useState(records[0]?.id ?? '');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!date) return setFormError('Choose the day you would like to come.');
    setSending(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patient-portal/appointments/request`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('patientToken')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId, preferredDate: date, preferredTime: time || undefined, reason: reason.trim() || undefined }),
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error || 'The request could not be sent');
      setOpen(false);
      setDate('');
      setTime('');
      setReason('');
      setSent(true);
      await onChanged();
    } catch (err: any) {
      onError(err?.message || 'The request could not be sent. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <section>
      <TabIntro
        title="Appointments"
        action={!open && records.length > 0 && (
          <Button onClick={() => { setOpen(true); setSent(false); }}>
            <CalendarPlus className="size-4" aria-hidden="true" /> Ask for an appointment
          </Button>
        )}
      >
        Ask your facility for an appointment. It confirms the day and time, and you get a notification.
      </TabIntro>

      {sent && (
        <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          Request sent. The facility will confirm it, and you will get a notification.
        </p>
      )}

      {open && (
        <PortalCard className="mb-4">
          <form onSubmit={submit} className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-slate-950 dark:text-slate-50">Ask for an appointment</p>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close the form">
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            {several && (
              <div>
                <Label htmlFor="request-facility" className="text-xs">Facility</Label>
                <Select id="request-facility" value={recordId} onChange={(e) => setRecordId(e.target.value)}>
                  {records.map((r) => <option key={r.id} value={r.id}>{r.clinic.name}</option>)}
                </Select>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="request-date" className="text-xs">Day you would like</Label>
                <Input id="request-date" type="date" min={kampalaToday()} value={date} onChange={(e) => setDate(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="request-time" className="text-xs">Time (optional)</Label>
                <Input id="request-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
            </div>
            <div>
              <Label htmlFor="request-reason" className="text-xs">What is it about? (optional)</Label>
              <Input id="request-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: follow-up on my lab result" maxLength={300} />
            </div>
            {formError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{formError}</p>}
            <Button type="submit" disabled={sending}>{sending ? 'Sending...' : 'Send request'}</Button>
          </form>
        </PortalCard>
      )}

      {requests.length > 0 && (
        <div className="mb-5">
          <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Your requests</h3>
          <ul className="space-y-2">
            {requests.map((q) => {
              const state = REQUEST_STATES[q.status];
              return (
                <li key={q.id}>
                  <PortalCard className="py-3 sm:py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm text-slate-800 dark:text-slate-200">
                        <span className="font-medium">{appointmentDate(q.preferredDate)}{q.preferredTime ? ` at ${q.preferredTime}` : ''}</span>{' '}
                        <FacilityTag name={q.facility} show={several} />
                      </p>
                      <StateBadge tone={state.tone}>{state.label}</StateBadge>
                    </div>
                    {q.reason && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{q.reason}</p>}
                    {q.status === 'DECLINED' && q.declineReason && (
                      <p className="mt-1 text-sm text-slate-700 dark:text-slate-300"><span className="font-medium">The facility said:</span> {q.declineReason}</p>
                    )}
                  </PortalCard>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Coming up</h3>
      {upcoming.length === 0 ? (
        <EmptyState icon={CalendarClock} title="No appointments booked">Ask for one above. Once your facility confirms it, it shows here with the day, time and who you will see.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {upcoming.map((a) => (
            <li key={a.id}>
              <PortalCard className="flex flex-wrap items-center justify-between gap-2 border-emerald-200 dark:border-emerald-900">
                <div>
                  <p className="font-semibold text-slate-950 dark:text-slate-50">{appointmentDate(a.date)} at {a.time}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">With {a.doctor.name} <FacilityTag name={a.facility} show={several} /></p>
                </div>
                <StateBadge tone="good">Booked</StateBadge>
              </PortalCard>
            </li>
          ))}
        </ul>
      )}

      {past.length > 0 && (
        <>
          <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-700 dark:text-slate-300">Earlier</h3>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {past.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="text-slate-700 dark:text-slate-300">
                  {portalDate(a.date)} at {a.time}, with {a.doctor.name} <FacilityTag name={a.facility} show={several} />
                </span>
                <StateBadge tone={a.status === 'COMPLETED' ? 'waiting' : 'muted'}>{APPOINTMENT_STATES[a.status] ?? a.status}</StateBadge>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
