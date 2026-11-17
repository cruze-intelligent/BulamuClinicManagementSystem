import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const local = vi.hoisted(() => ({
  appointments: [] as any[],
  updateAppointmentOffline: vi.fn(async (..._args: unknown[]) => ({})),
  createAppointmentOffline: vi.fn(async (..._args: unknown[]) => ({})),
}));
vi.mock('@/lib/local-first', () => ({
  getCurrentUser: () => ({ id: 'u-desk', name: 'Akello Front Desk' }),
  listLocalAppointments: async () => local.appointments,
  subscribeToLocalChanges: () => () => {},
  updateAppointmentOffline: local.updateAppointmentOffline,
  createAppointmentOffline: local.createAppointmentOffline,
}));
vi.mock('@/lib/useAuth', () => ({ useAuth: () => ({ hasRole: (...roles: string[]) => roles.includes('STAFF') }) }));

import { AddToQueue } from './add-to-queue';

const patient = { id: 'p1', name: 'Okot John', clinicId: 'c1' };
const day = 24 * 60 * 60 * 1000;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

function withUnits() {
  localStorage.setItem('departments_c1', JSON.stringify([
    { id: 'd-opd', code: 'OPD', name: 'General OPD', isActive: true },
    { id: 'd-dental', code: 'DENTAL', name: 'Dentistry', isActive: true },
  ]));
}

describe('adding a patient to the waiting queue', () => {
  it('adds a patient with no appointment as a walk-in, in the unit chosen', async () => {
    withUnits();
    local.appointments = [];
    render(<AddToQueue patient={patient} />);
    fireEvent.change(await screen.findByLabelText('Unit'), { target: { value: 'd-dental' } });
    fireEvent.click(screen.getByRole('button', { name: /Add to the waiting queue/ }));
    await waitFor(() => expect(local.createAppointmentOffline).toHaveBeenCalled());
    expect(local.createAppointmentOffline.mock.calls[0][0]).toMatchObject({ patientId: 'p1', notes: 'Walk-in', departmentId: 'd-dental', checkedInAt: expect.any(String) });
  });

  it('checks a booked patient in for their appointment, in the unit they were booked into', async () => {
    withUnits();
    local.appointments = [{ id: 'a1', patientId: 'p1', clinicId: 'c1', status: 'SCHEDULED', date: new Date().toISOString(), time: '10:30', checkedInAt: null, departmentId: 'd-dental' }];
    render(<AddToQueue patient={patient} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check in for the 10:30 appointment' }));
    await waitFor(() => expect(local.updateAppointmentOffline).toHaveBeenCalled());
    expect(local.updateAppointmentOffline.mock.calls[0]).toEqual([expect.objectContaining({ id: 'a1' }), { checkedInAt: expect.any(String), departmentId: 'd-dental' }]);
  });

  it('checks in a patient who came on another day than booked, moving the visit to today', async () => {
    local.appointments = [{ id: 'a2', patientId: 'p1', clinicId: 'c1', status: 'SCHEDULED', date: new Date(Date.now() + 3 * day).toISOString(), time: '09:00', checkedInAt: null }];
    render(<AddToQueue patient={patient} />);
    fireEvent.click(await screen.findByRole('button', { name: /Check in now \(booked for/ }));
    await waitFor(() => expect(local.updateAppointmentOffline).toHaveBeenCalled());
    const change = local.updateAppointmentOffline.mock.calls[0][1] as any;
    expect(change).toMatchObject({ checkedInAt: expect.any(String), date: expect.any(String), time: expect.stringMatching(/^\d{2}:\d{2}$/) });
    expect(Math.abs(new Date(change.date).getTime() - Date.now())).toBeLessThan(60_000);
  });

  it('says where a patient already waiting is, instead of queueing them twice', async () => {
    withUnits();
    local.appointments = [{ id: 'a3', patientId: 'p1', clinicId: 'c1', status: 'SCHEDULED', date: new Date().toISOString(), time: '08:00', checkedInAt: new Date(Date.now() - 10 * 60_000).toISOString(), departmentId: 'd-opd' }];
    render(<AddToQueue patient={patient} />);
    expect(await screen.findByText(/In the waiting room for General OPD since/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
