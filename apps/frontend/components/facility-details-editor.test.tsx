import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FacilityDetailsEditor } from './facility-details-editor';
import { FacilityChangeReviews } from './facility-change-reviews';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const FACILITY = {
  id: 'c1', facilityCode: 'BLM-MBR123', name: 'Mbarara Family Clinic', facilityType: 'CLINIC', phone: '0772 111 222',
  address: 'Plot 4, High Street', district: 'Mbarara', subCounty: null, parish: null,
};
const allowance = (remaining: number) => ({ limit: 3, windowDays: 365, used: 3 - remaining, remaining, nextFreeAt: remaining ? null : '2027-03-01T09:00:00Z' });
const PENDING = {
  id: 'ch1', status: 'PENDING', changes: { name: { from: 'Mbarara Family Clinic', to: 'Mbarara Hospital' } }, note: 'Upgraded by the ministry',
  reviewNote: null, createdAt: '2026-11-04T09:00:00Z', reviewedAt: null, requestedByUser: { name: 'Grace Nankya' }, reviewedByUser: null,
};

/** A stand-in API: answers GET details with `loaded`, and the change calls with `saved`. */
function server(loaded: object, saved: object = {}, status = 200) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = method === 'GET' ? { success: true, ...loaded } : { success: true, ...saved };
    return { ok: status < 400, status, json: async () => body };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const sent = (fetchMock: ReturnType<typeof server>, method: string) =>
  fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === method) as unknown as Array<[string, RequestInit]>;

describe('the facility details on the Facility page', () => {
  it('shows staff the details without letting them change them', async () => {
    server({ facility: FACILITY });
    render(<FacilityDetailsEditor clinicId="c1" isAdmin={false} />);
    expect(await screen.findByText('Mbarara Family Clinic')).toBeTruthy();
    expect(screen.getByText('Facility ID BLM-MBR123 · Clinic')).toBeTruthy();
    expect(screen.getByText('Your facility administrator can change these details.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Edit details/ })).toBeNull();
  });

  it('saves only what the administrator changed, and the rest of the app shows the new name', async () => {
    localStorage.setItem('user', JSON.stringify({ name: 'Grace', clinic: { name: 'Mbarara Family Clinic', facilityCode: 'BLM-MBR123' } }));
    const fetchMock = server(
      { facility: FACILITY, allowance: allowance(3), pending: null, history: [] },
      { outcome: 'APPLIED', facility: { ...FACILITY, name: 'Mbarara Hospital' }, message: 'Facility details saved. Your documents now print the new details.' },
    );
    const changed = vi.fn();
    render(<FacilityDetailsEditor clinicId="c1" isAdmin onChanged={changed} />);
    expect(await screen.findByText(/You can make 3 more changes yourself/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Edit details/ }));
    expect(screen.queryByLabelText('Why the details are changing')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Save the details' }));
    expect(screen.getByRole('alert').textContent).toBe('Nothing has changed yet');
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '0772' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the details' }));
    expect(screen.getByRole('alert').textContent).toMatch(/9 to 15 digits/);
    expect(sent(fetchMock, 'PATCH')).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '0772 111 222' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Mbarara Hospital ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the details' }));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    const [[url, init]] = sent(fetchMock, 'PATCH');
    expect(url).toMatch(/\/clinics\/c1\/details$/);
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Mbarara Hospital' });
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/Facility details saved/);
    expect(JSON.parse(localStorage.getItem('user')!).clinic).toMatchObject({ name: 'Mbarara Hospital', facilityCode: 'BLM-MBR123' });
  });

  it('after three changes, asks why and sends the change to Bulamu instead', async () => {
    const fetchMock = server(
      { facility: FACILITY, allowance: allowance(0), pending: null, history: [] },
      { outcome: 'PENDING', facility: FACILITY, message: 'Sent to Bulamu for review.' }, 202,
    );
    const changed = vi.fn();
    render(<FacilityDetailsEditor clinicId="c1" isAdmin onChanged={changed} />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit details/ }));
    expect(screen.getByText(/changed its details 3 times in the last 12 months, so Bulamu checks each further change until 1 Mar 2027/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mbarara Hospital' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Bulamu for review' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Say why the details are changing/);
    expect(sent(fetchMock, 'PATCH')).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('Why the details are changing'), { target: { value: 'Upgraded by the ministry' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Bulamu for review' }));
    await waitFor(() => expect(sent(fetchMock, 'PATCH')).toHaveLength(1));
    expect(JSON.parse(String(sent(fetchMock, 'PATCH')[0][1].body))).toEqual({ name: 'Mbarara Hospital', note: 'Upgraded by the ministry' });
    expect((await screen.findByRole('status')).textContent).toBe('Sent to Bulamu for review.');
    expect(changed).not.toHaveBeenCalled();
  });

  it('shows a change waiting for Bulamu, which the administrator can withdraw', async () => {
    vi.stubGlobal('confirm', () => true);
    const fetchMock = server({ facility: FACILITY, allowance: allowance(0), pending: PENDING, history: [PENDING] });
    render(<FacilityDetailsEditor clinicId="c1" isAdmin />);
    expect(await screen.findByText('Waiting for Bulamu to check this change')).toBeTruthy();
    expect(screen.getByText('Mbarara Hospital')).toBeTruthy();
    expect(screen.getByText('Why: Upgraded by the ministry')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Edit details/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw the change' }));
    await waitFor(() => expect(sent(fetchMock, 'DELETE')).toHaveLength(1));
    expect(sent(fetchMock, 'DELETE')[0][0]).toMatch(/\/clinics\/c1\/details\/pending$/);
  });
});

describe('the review queue for Bulamu administrators', () => {
  const WAITING = {
    id: 'ch1', clinic: { id: 'c1', name: 'Mbarara Family Clinic', facilityCode: 'BLM-MBR123' }, rows: [['Name', 'Mbarara Family Clinic', 'Mbarara Hospital']],
    note: 'Upgraded by the ministry', createdAt: '2026-11-04T09:00:00Z', changesThisYear: 3, requestedByUser: { name: 'Grace Nankya', email: 'grace@example.org' },
  };

  it('stays out of the way when nothing is waiting', async () => {
    const fetchMock = server({ changes: [] });
    const { container } = render(<FacilityChangeReviews />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('approves a change, and turns one down only with a reason', async () => {
    const fetchMock = server({ changes: [WAITING] });
    render(<FacilityChangeReviews />);
    expect(await screen.findByText('Facility details to review (1)')).toBeTruthy();
    expect(screen.getByText(/Grace Nankya \(grace@example.org\)/)).toBeTruthy();
    expect(screen.getByText('Why: Upgraded by the ministry')).toBeTruthy();

    vi.stubGlobal('prompt', () => '  ');
    fireEvent.click(screen.getByRole('button', { name: /Turn down/ }));
    expect(screen.getByRole('alert').textContent).toMatch(/Give a reason/);
    expect(sent(fetchMock, 'POST')).toHaveLength(0);

    vi.stubGlobal('prompt', () => 'Send the ministry letter');
    fireEvent.click(screen.getByRole('button', { name: /Turn down/ }));
    await waitFor(() => expect(sent(fetchMock, 'POST')).toHaveLength(1));
    const [url, init] = sent(fetchMock, 'POST')[0];
    expect(url).toMatch(/\/super-admin\/facility-changes\/ch1\/reject$/);
    expect(JSON.parse(String(init.body))).toEqual({ note: 'Send the ministry letter' });
    expect((await screen.findByRole('status')).textContent).toMatch(/was not made/);
  });

  it('approving sends no note and says the new details are in place', async () => {
    const fetchMock = server({ changes: [WAITING] });
    render(<FacilityChangeReviews />);
    fireEvent.click(await screen.findByRole('button', { name: /Approve and make the change/ }));
    await waitFor(() => expect(sent(fetchMock, 'POST')).toHaveLength(1));
    expect(sent(fetchMock, 'POST')[0][0]).toMatch(/\/ch1\/approve$/);
    expect((await screen.findByRole('status')).textContent).toMatch(/new details for Mbarara Family Clinic are in place/);
  });
});
