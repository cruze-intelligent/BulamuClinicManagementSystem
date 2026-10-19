import { describe, expect, it } from 'vitest';
import {
  ageOf, allergySummary, appointmentDate, billState, billsSummary, gather, greeting, labState, latestLabTest, nextAppointment, splitAppointments,
  type PortalRecord,
} from './patient-portal';

function record(overrides: Partial<PortalRecord> = {}): PortalRecord {
  return {
    id: 'r1', name: 'Achieng Mary', clinic: { id: 'c1', name: 'Kampala Health Centre', facilityType: 'HEALTH_CENTRE_III' },
    appointments: [], consultations: [], labTests: [], appointmentRequests: [], documents: [], invoices: [],
    ...overrides,
  };
}
const bill = (amount: number, amountPaid: number, status = amountPaid >= amount ? 'PAID' : 'PENDING') =>
  ({ id: `b${amount}${amountPaid}`, amount, amountPaid, balance: Math.max(0, amount - amountPaid), status, createdAt: '2026-10-10T09:00:00Z', consultationId: null, items: [], payments: [] });

// 19 Oct 2026, 10:00 in Kampala.
const NOW = new Date('2026-10-19T07:00:00Z');

describe('the patient portal, in the patient\'s words', () => {
  it('shows a lab result only once a clinician has checked it', () => {
    const base = { id: 't', testName: 'Malaria RDT', createdAt: '2026-10-18T08:00:00Z' };
    expect(labState({ ...base, status: 'PENDING', results: '' })).toEqual({ label: 'Waiting for the result', tone: 'waiting' });
    expect(labState({ ...base, status: 'COMPLETED', results: '', verified: false })).toEqual({ label: 'Being checked by a clinician', tone: 'pending' });
    expect(labState({ ...base, status: 'COMPLETED', results: 'Negative', verified: true })).toEqual({ label: 'Result ready', tone: 'good' });
    expect(labState({ ...base, status: 'CANCELLED', results: '' }).label).toBe('Cancelled');
  });

  it('says whether a bill is paid, part paid or not yet paid, and adds up what is still owed', () => {
    expect(billState(bill(20000, 20000)).label).toBe('Paid');
    expect(billState(bill(20000, 10000)).label).toBe('Part paid');
    expect(billState(bill(20000, 0)).label).toBe('Not yet paid');
    const records = [record({ invoices: [bill(20000, 10000), bill(5000, 5000)] }), record({ id: 'r2', invoices: [bill(3000, 0)] })];
    expect(billsSummary(records)).toEqual({ billed: 28000, paid: 15000, owed: 13000, open: 2, count: 3 });
  });

  it('finds the soonest appointment still to come - by the day in Kampala, not the server\'s', () => {
    const appointment = (id: string, date: string, time: string, status = 'SCHEDULED') => ({ id, date, time, status, notes: null, doctor: { name: 'Dr Okello' } });
    const records = [record({
      appointments: [
        appointment('yesterday', '2026-10-18T00:00:00.000Z', '09:00'),
        appointment('later', '2026-10-25T00:00:00.000Z', '08:00'),
        appointment('today', '2026-10-19T00:00:00.000Z', '15:30'),
        appointment('cancelled', '2026-10-20T00:00:00.000Z', '09:00', 'CANCELLED'),
      ],
    })];
    expect(nextAppointment(records, NOW)?.id).toBe('today');
    const { upcoming, past } = splitAppointments(records, NOW);
    expect(upcoming.map((a) => a.id)).toEqual(['today', 'later']);
    expect(past.map((a) => a.id).sort()).toEqual(['cancelled', 'yesterday']);
    expect(nextAppointment([record()], NOW)).toBeNull();
    expect(appointmentDate('2026-10-19T00:00:00.000Z')).toBe('Mon, 19 Oct 2026');
  });

  it('gathers items from every facility, newest first, saying where each came from', () => {
    const records = [
      record({ labTests: [{ id: 'a', testName: 'Old', status: 'COMPLETED', results: '', createdAt: '2026-09-01T08:00:00Z' }] }),
      record({ id: 'r2', clinic: { id: 'c2', name: 'Mulago', facilityType: 'HOSPITAL' }, labTests: [{ id: 'b', testName: 'New', status: 'PENDING', results: '', createdAt: '2026-10-01T08:00:00Z' }] }),
    ];
    const tests = gather(records, (r) => r.labTests, (t) => t.createdAt);
    expect(tests.map((t) => [t.id, t.facility])).toEqual([['b', 'Mulago'], ['a', 'Kampala Health Centre']]);
    expect(latestLabTest(records)?.testName).toBe('New');
  });

  it('puts allergies first, says "no known allergies" only when a clinician recorded that, and never guesses', () => {
    expect(allergySummary([record({ allergyStatus: 'KNOWN', allergies: [{ substance: 'Penicillin' }, { substance: 'Sulfa' }] })])).toEqual({ text: 'Penicillin, Sulfa', known: true, recorded: true });
    expect(allergySummary([record({ allergyStatus: 'NONE_KNOWN' })]).text).toBe('No known allergies');
    expect(allergySummary([record({ allergyStatus: 'UNKNOWN' })])).toEqual({ text: 'None recorded yet', known: false, recorded: false });
  });

  it('works out age and greets by the time in Kampala', () => {
    expect(ageOf('1992-10-20T00:00:00.000Z', NOW)).toBe(33);
    expect(ageOf('1992-10-19T00:00:00.000Z', NOW)).toBe(34);
    expect(ageOf(null, NOW)).toBeNull();
    expect(greeting(NOW)).toBe('Good morning');
    expect(greeting(new Date('2026-10-19T11:30:00Z'))).toBe('Good afternoon');
    expect(greeting(new Date('2026-10-19T21:00:00Z'))).toBe('Good evening'); // midnight in Kampala
  });
});
