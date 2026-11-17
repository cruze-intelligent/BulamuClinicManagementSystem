import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const local = vi.hoisted(() => ({
  appointments: [] as any[],
  patients: [] as any[],
  updateAppointmentOffline: vi.fn(async (..._args: unknown[]) => ({})),
  createAppointmentOffline: vi.fn(async (..._args: unknown[]) => ({})),
}));
vi.mock('@/lib/local-first', () => ({
  getCurrentClinicId: () => 'c1',
  getCurrentUser: () => ({ id: 'u-desk', name: 'Akello Front Desk' }),
  listLocalAppointments: async () => local.appointments,
  listLocalPatients: async () => local.patients,
  subscribeToLocalChanges: () => () => {},
  updateAppointmentOffline: local.updateAppointmentOffline,
  createAppointmentOffline: local.createAppointmentOffline,
}));
vi.mock('@/lib/useAuth', () => ({ useAuth: () => ({ hasRole: (...roles: string[]) => roles.includes('DOCTOR') || roles.includes('STAFF') }) }));

import { WaitingRoom } from './waiting-room';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const today = new Date().toISOString();

describe('the waiting room', () => {
  it('lists those waiting in the order they arrived, the first marked next, and checks in and adds walk-ins', async () => {
    local.patients = [
      { id: 'p1', name: 'Achieng Mary', phone: '0700 1', patientNumber: 1, clinicId: 'c1' },
      { id: 'p2', name: 'Okot John', phone: '0700 2', patientNumber: 2, clinicId: 'c1' },
      { id: 'p3', name: 'Adong Grace', phone: '0700 3', patientNumber: 3, clinicId: 'c1' },
      { id: 'p4', name: 'Opio Peter', phone: '0700 4', patientNumber: 4, clinicId: 'c1' },
    ];
    local.appointments = [
      { id: 'a-late', patientId: 'p2', status: 'SCHEDULED', date: today, time: '09:30', checkedInAt: minutesAgo(5) },
      { id: 'a-early', patientId: 'p1', status: 'SCHEDULED', date: today, time: '09:00', checkedInAt: minutesAgo(40) },
      { id: 'a-booked', patientId: 'p3', status: 'SCHEDULED', date: today, time: '11:00', checkedInAt: null },
      { id: 'a-seen', patientId: 'p4', status: 'COMPLETED', date: today, time: '08:00', checkedInAt: minutesAgo(90) },
    ];
    render(<WaitingRoom />);

    const queue = await screen.findAllByRole('listitem');
    const waiting = queue.filter((li) => li.textContent?.includes('Arrived'));
    expect(waiting.map((li) => within(li).getByText(/Achieng|Okot/).textContent)).toEqual([expect.stringContaining('Achieng Mary'), expect.stringContaining('Okot John')]);
    expect(within(waiting[0]).getByText('Next')).toBeTruthy();
    expect(within(waiting[0]).getByText(/waiting 40 min/)).toBeTruthy();
    expect(screen.getByText('Waiting room (2)')).toBeTruthy();
    expect((within(waiting[0]).getByRole('link') as HTMLAnchorElement).getAttribute('href')).toBe('/consultations/record?appointmentId=a-early&patientId=p1');

    fireEvent.click(screen.getByRole('button', { name: /Check in/ }));
    await waitFor(() => expect(local.updateAppointmentOffline).toHaveBeenCalled());
    expect(local.updateAppointmentOffline.mock.calls[0][0]).toMatchObject({ id: 'a-booked' });

    // Those already waiting are not offered again as walk-ins.
    const options = Array.from((screen.getByLabelText('Add a walk-in to the queue') as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options.some((o) => o?.startsWith('Achieng Mary'))).toBe(false);
    fireEvent.change(screen.getByLabelText('Add a walk-in to the queue'), { target: { value: 'p4' } });
    fireEvent.click(screen.getByRole('button', { name: /Add to queue/ }));
    await waitFor(() => expect(local.createAppointmentOffline).toHaveBeenCalled());
    expect(local.createAppointmentOffline.mock.calls[0][0]).toMatchObject({ patientId: 'p4', notes: 'Walk-in', checkedInAt: expect.any(String) });
  });
});

describe('the waiting room of a facility with units', () => {
  it('opens on the unit the person works in, keeps a queue per unit, moves a patient sent to the wrong one, and adds walk-ins to the unit', async () => {
    localStorage.setItem('departments_c1', JSON.stringify([
      { id: 'd-opd', code: 'OPD', name: 'General OPD', isActive: true },
      { id: 'd-dental', code: 'DENTAL', name: 'Dentistry', isActive: true },
      { id: 'd-eye', code: 'EYE', name: 'Eye Clinic (Ophthalmology)', isActive: false },
    ]));
    localStorage.setItem('myDepartmentIds', JSON.stringify(['d-dental']));
    local.patients = [
      { id: 'p1', name: 'Achieng Mary', phone: '0700 1', patientNumber: 1, clinicId: 'c1' },
      { id: 'p2', name: 'Okot John', phone: '0700 2', patientNumber: 2, clinicId: 'c1' },
      { id: 'p3', name: 'Adong Grace', phone: '0700 3', patientNumber: 3, clinicId: 'c1' },
      { id: 'p4', name: 'Opio Peter', phone: '0700 4', patientNumber: 4, clinicId: 'c1' },
    ];
    local.appointments = [
      { id: 'a1', patientId: 'p1', status: 'SCHEDULED', date: today, time: '09:00', checkedInAt: minutesAgo(40), departmentId: 'd-opd' },
      { id: 'a2', patientId: 'p2', status: 'SCHEDULED', date: today, time: '09:10', checkedInAt: minutesAgo(30), departmentId: 'd-dental' },
      { id: 'a3', patientId: 'p3', status: 'SCHEDULED', date: today, time: '09:20', checkedInAt: minutesAgo(20), departmentId: 'd-opd' },
    ];
    render(<WaitingRoom />);

    // A dentist sees the dental queue first.
    expect(await screen.findByText('Waiting room - Dentistry (1)')).toBeTruthy();
    expect(screen.getByText('Okot John')).toBeTruthy();
    expect(screen.queryByText('Achieng Mary')).toBeNull();
    // A closed unit has no queue.
    expect(screen.queryByRole('button', { name: /Eye Clinic/ })).toBeNull();

    // Everyone, in order of arrival, each with their unit.
    fireEvent.click(screen.getByRole('button', { name: /All units/ }));
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((li) => li.textContent)).toEqual([
      expect.stringMatching(/Achieng Mary.*General OPD/), expect.stringMatching(/Okot John.*Dentistry/), expect.stringMatching(/Adong Grace.*General OPD/),
    ]);

    // Sent to the wrong queue: moved, keeping their arrival time.
    fireEvent.change(screen.getByLabelText('Send Adong Grace to another unit'), { target: { value: 'd-dental' } });
    await waitFor(() => expect(local.updateAppointmentOffline).toHaveBeenCalled());
    expect(local.updateAppointmentOffline.mock.calls[0]).toEqual([expect.objectContaining({ id: 'a3' }), { departmentId: 'd-dental' }]);

    // A walk-in joins the unit on screen.
    fireEvent.click(screen.getByRole('button', { name: /General OPD/ }));
    expect(screen.getByText('Waiting room - General OPD (2)')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Add a walk-in to the queue'), { target: { value: 'p4' } });
    fireEvent.click(screen.getByRole('button', { name: /Add to queue/ }));
    await waitFor(() => expect(local.createAppointmentOffline).toHaveBeenCalled());
    expect(local.createAppointmentOffline.mock.calls[0][0]).toMatchObject({ patientId: 'p4', departmentId: 'd-opd', checkedInAt: expect.any(String) });
  });
});
