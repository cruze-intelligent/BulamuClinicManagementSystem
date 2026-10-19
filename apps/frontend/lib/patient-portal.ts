// What the Patient Portal shows, worked out from GET /patient-portal/me: the
// records each facility holds about the patient, put into the patient's words.
import type { DiagnosisView } from '@/lib/diagnosis';
import type { PrescriptionView } from '@/lib/prescription';
import type { DocumentFormat } from '@/components/document-item';
import type { PortalReferral, PortalStay } from '@/components/portal-stays-referrals';
import { kampalaToday, shortDate } from '@/lib/finance';

export type PortalBill = {
  id: string;
  amount: number;
  amountPaid: number;
  balance: number;
  status: string;
  createdAt: string;
  consultationId: string | null;
  items: Array<{ id: string; kind: string; kindLabel: string; description: string; quantity: number; unitPrice: number; amount: number }>;
  payments: Array<{ id: string; receiptNumber: string; amount: number; method: string | null; receivedAt: string }>;
};

export type PortalLabTest = { id: string; testName: string; results: string; status: string; verified?: boolean; verifiedAt?: string | null; createdAt: string };

export type PortalAppointment = { id: string; date: string; time: string; status: string; notes: string | null; doctor: { name: string } };

export type PortalAppointmentRequest = {
  id: string;
  preferredDate: string;
  preferredTime: string | null;
  reason: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED';
  declineReason: string | null;
  createdAt: string;
};

export type PortalDocument = {
  id: string;
  category: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
  uploadedByPatientAccountId: string | null;
  format?: DocumentFormat;
};

export type PortalConsultation = {
  id: string;
  diagnosis: string;
  symptoms: string;
  createdAt: string;
  diagnoses: DiagnosisView[];
  prescriptions: Array<PrescriptionView & { id: string }>;
  invoice: { id: string; amount: number; amountPaid?: number; status: string; createdAt: string } | null;
};

export type PortalRecord = {
  id: string;
  name: string;
  sex?: string | null;
  dateOfBirth?: string | null;
  clinic: { id: string; name: string; facilityType: string };
  allergyStatus?: 'UNKNOWN' | 'NONE_KNOWN' | 'KNOWN';
  allergies?: Array<{ substance: string; reaction?: string | null; severity?: 'MILD' | 'MODERATE' | 'SEVERE' | null }> | null;
  appointments: PortalAppointment[];
  consultations: PortalConsultation[];
  labTests: PortalLabTest[];
  appointmentRequests: PortalAppointmentRequest[];
  documents: PortalDocument[];
  referrals?: PortalReferral[];
  admissions?: PortalStay[];
  invoices?: PortalBill[];
};

export type PortalMe = {
  account: { portableId: string; email: string; phone: string; createdAt: string };
  records: PortalRecord[];
};

/** An item from one of the patient's records, with the facility it came from. */
export type FromFacility<T> = T & { facility: string; recordId: string };

/** Everything of one kind across all the patient's facilities, newest first. */
export function gather<T>(records: PortalRecord[], pick: (r: PortalRecord) => T[] | undefined, dateOf: (item: T) => string): Array<FromFacility<T>> {
  return records
    .flatMap((r) => (pick(r) ?? []).map((item) => ({ ...item, facility: r.clinic.name, recordId: r.id })))
    .sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
}

/** The patient's name as their facility recorded it (the first record's, if several). */
export const patientName = (me: PortalMe) => me.records[0]?.name ?? '';

/** "Good morning" etc., by the time in Kampala. */
export function greeting(now: Date = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Africa/Kampala' }).format(now));
  if (hour < 5) return 'Good evening'; // the small hours are still the evening
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Age in whole years, or null when no date of birth was recorded. */
export function ageOf(dateOfBirth: string | null | undefined, now: Date = new Date()): number | null {
  if (!dateOfBirth) return null;
  const born = new Date(dateOfBirth);
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const beforeBirthday = now.getUTCMonth() < born.getUTCMonth() || (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : null;
}

export type Tone = 'good' | 'pending' | 'waiting' | 'muted' | 'owed';

/** Where a lab test is, in the patient's words. A result is shown only once a clinician has checked it. */
export function labState(test: PortalLabTest): { label: string; tone: Tone } {
  if (test.status === 'CANCELLED') return { label: 'Cancelled', tone: 'muted' };
  if (test.verified && test.results) return { label: 'Result ready', tone: 'good' };
  if (test.status === 'COMPLETED') return { label: 'Being checked by a clinician', tone: 'pending' };
  return { label: 'Waiting for the result', tone: 'waiting' };
}

/** Paid, part paid or not yet paid. */
export function billState(bill: Pick<PortalBill, 'amount' | 'amountPaid' | 'status'>): { label: string; tone: Tone } {
  if (bill.status === 'PAID' || bill.amountPaid >= bill.amount) return { label: 'Paid', tone: 'good' };
  if (bill.amountPaid > 0) return { label: 'Part paid', tone: 'owed' };
  return { label: 'Not yet paid', tone: 'owed' };
}

export function billsSummary(records: PortalRecord[]): { billed: number; paid: number; owed: number; open: number; count: number } {
  const bills = records.flatMap((r) => r.invoices ?? []);
  return {
    billed: bills.reduce((sum, b) => sum + b.amount, 0),
    paid: bills.reduce((sum, b) => sum + b.amountPaid, 0),
    owed: bills.reduce((sum, b) => sum + b.balance, 0),
    open: bills.filter((b) => b.balance > 0).length,
    count: bills.length,
  };
}

/** The date part of a stored appointment date, as a Kampala day ("2026-10-19"). */
const dayOf = (iso: string) => iso.slice(0, 10);

/** The soonest booked appointment from today on. */
export function nextAppointment(records: PortalRecord[], now: Date = new Date()): FromFacility<PortalAppointment> | null {
  const today = kampalaToday(now);
  const upcoming = gather(records, (r) => r.appointments, (a) => a.date)
    .filter((a) => a.status === 'SCHEDULED' && dayOf(a.date) >= today)
    .sort((a, b) => `${dayOf(a.date)} ${a.time}`.localeCompare(`${dayOf(b.date)} ${b.time}`));
  return upcoming[0] ?? null;
}

/** Appointments split into those still to come and those gone by. */
export function splitAppointments(records: PortalRecord[], now: Date = new Date()) {
  const today = kampalaToday(now);
  const all = gather(records, (r) => r.appointments, (a) => a.date);
  const upcoming = all.filter((a) => a.status === 'SCHEDULED' && dayOf(a.date) >= today)
    .sort((a, b) => `${dayOf(a.date)} ${a.time}`.localeCompare(`${dayOf(b.date)} ${b.time}`));
  const past = all.filter((a) => !upcoming.includes(a));
  return { upcoming, past };
}

export const APPOINTMENT_STATES: Record<string, string> = { SCHEDULED: 'Booked', COMPLETED: 'Attended', CANCELLED: 'Cancelled', NO_SHOW: 'Missed' };

/** The newest lab test that wasn't cancelled. */
export function latestLabTest(records: PortalRecord[]): FromFacility<PortalLabTest> | null {
  return gather(records, (r) => r.labTests, (t) => t.createdAt).find((t) => t.status !== 'CANCELLED') ?? null;
}

/** Allergies recorded at any facility, in one line. */
export function allergySummary(records: PortalRecord[]): { text: string; known: boolean; recorded: boolean } {
  const known = records.flatMap((r) => (r.allergyStatus === 'KNOWN' ? r.allergies ?? [] : []));
  if (known.length > 0) {
    const names = [...new Set(known.map((a) => a.substance))];
    return { text: names.join(', '), known: true, recorded: true };
  }
  if (records.some((r) => r.allergyStatus === 'NONE_KNOWN')) return { text: 'No known allergies', known: false, recorded: true };
  return { text: 'None recorded yet', known: false, recorded: false };
}

/** A Ugandan date the same on every phone: 14 Oct 2026. */
export const portalDate = shortDate;

/** A stored appointment day (midnight UTC) as a date, without shifting it a day. */
export const appointmentDate = (iso: string) =>
  new Date(`${dayOf(iso)}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Kampala' });
