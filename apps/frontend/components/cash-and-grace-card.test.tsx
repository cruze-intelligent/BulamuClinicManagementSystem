import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CashAndGraceCard } from './cash-and-grace-card';
import type { BillingFacility } from '@/lib/subscription-admin';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const PAID: BillingFacility = { id: 'c1', name: 'Gulu Family Clinic', facilityCode: 'BLM-GU04', subscription: { status: 'ACTIVE', amount: 100000, currency: 'UGX', trialEndsAt: at(-60), currentPeriodEnd: at(10), lastPaymentAt: at(-20) } };
const LAPSED: BillingFacility = { id: 'c2', name: 'Arua Health Centre', facilityCode: 'BLM-AR01', subscription: { status: 'PAST_DUE', amount: 150000, currency: 'UGX', trialEndsAt: at(-90), currentPeriodEnd: at(-3), lastPaymentAt: at(-33), graceDays: 2, graceFrom: at(-5) } };
const TRIAL: BillingFacility = { id: 'c3', name: 'Chiro Clinic', facilityCode: 'BLM-CH03', subscription: { status: 'PAST_DUE', amount: 100000, trialEndsAt: at(-2), currentPeriodEnd: null, lastPaymentAt: null } };

function server(reply: object, pending: object[] = []) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    // Opening the card asks which Pesapal payments are waiting; the rest are what it records.
    json: async () => (init?.method === 'POST' ? { success: true, ...reply } : { success: true, payments: pending }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const posts = (fetchMock: ReturnType<typeof server>) => (fetchMock.mock.calls as unknown as Array<[string, RequestInit | undefined]>).filter(([, init]) => init?.method === 'POST');
const body = (fetchMock: ReturnType<typeof server>, i = 0) => JSON.parse(String(posts(fetchMock)[i][1]!.body));
const url = (fetchMock: ReturnType<typeof server>, i = 0) => posts(fetchMock)[i][0];

describe('the card for recording payments by hand', () => {
  it('fills in what the months cost, records the cash once confirmed, and offers the receipt', async () => {
    const fetchMock = server({ paidUntil: '2026-12-17T09:00:00Z', receiptPath: '/billing/receipts/p1/pdf' });
    vi.stubGlobal('confirm', vi.fn(() => true));
    const changed = vi.fn();
    render(<CashAndGraceCard facilities={[PAID, LAPSED, TRIAL]} onChanged={changed} />);

    fireEvent.change(screen.getByLabelText('Facility'), { target: { value: 'c1' } });
    expect((screen.getByLabelText('Amount received (UGX)') as HTMLInputElement).value).toBe('100,000');
    fireEvent.change(screen.getByLabelText('Months paid'), { target: { value: '2' } });
    expect((screen.getByLabelText('Amount received (UGX)') as HTMLInputElement).value).toBe('200,000');

    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(screen.getByRole('alert').textContent).toBe('Enter the name of the person who handed over the cash');
    fireEvent.change(screen.getByLabelText('Paid by'), { target: { value: 'Okello James' } });
    fireEvent.change(screen.getByLabelText('Amount received (UGX)'), { target: { value: '150,000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(screen.getByRole('alert').textContent).toMatch(/2 months at UGX 100,000 is UGX 200,000/);
    expect(posts(fetchMock)).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('Amount received (UGX)'), { target: { value: '200,000' } });
    fireEvent.change(screen.getByLabelText(/Receipt book number/), { target: { value: 'RB 0042' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    expect(url(fetchMock)).toMatch(/\/billing\/manual\/c1$/);
    const sent = body(fetchMock);
    expect(sent).toMatchObject({ method: 'CASH', months: 2, amount: 200000, paidBy: 'Okello James', reference: 'RB 0042' });
    expect(typeof sent.requestKey).toBe('string');
    expect(screen.getByRole('status').textContent).toMatch(/UGX 200,000 in cash from Gulu Family Clinic is recorded. It is paid until 17 Dec 2026/);
    expect(screen.getByRole('button', { name: /Receipt for Gulu Family Clinic/ })).toBeTruthy();
    // The form is cleared for the next payment, with a new key.
    expect((screen.getByLabelText('Facility') as HTMLSelectElement).value).toBe('');
  });

  it('records nothing when the confirmation is cancelled', () => {
    const fetchMock = server({});
    vi.stubGlobal('confirm', vi.fn(() => false));
    render(<CashAndGraceCard facilities={[PAID]} onChanged={() => {}} />);
    fireEvent.change(screen.getByLabelText('Facility'), { target: { value: 'c1' } });
    fireEvent.change(screen.getByLabelText('Paid by'), { target: { value: 'Okello James' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it('lists only paid facilities that ran out for grace, with the days still allowed', async () => {
    const fetchMock = server({ graceEndsAt: '2026-11-12T09:00:00Z', emailed: true });
    render(<CashAndGraceCard facilities={[PAID, LAPSED, TRIAL]} onChanged={() => {}} />);
    expect(screen.getByText('Arua Health Centre')).toBeTruthy();
    expect(screen.queryByText('Chiro Clinic')).toBeNull(); // a trial: extended under Free trials instead
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    const days = screen.getByLabelText('Grace days for Arua Health Centre') as HTMLSelectElement;
    expect(Array.from(days.options).map((o) => o.value)).toEqual(['1', '2', '3', '4', '5']);

    fireEvent.change(days, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Give grace days' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(url(fetchMock)).toMatch(/\/billing\/grace\/c2$/);
    expect(body(fetchMock)).toEqual({ days: 3 });
    expect((await screen.findByRole('status')).textContent).toBe('Arua Health Centre can keep working until 12 Nov 2026 (3 grace days given). Its administrator has been emailed.');
  });

  it('records mobile money with its network and transaction ID', async () => {
    const fetchMock = server({ paidUntil: '2026-12-17T09:00:00Z', receiptPath: '/billing/receipts/p2/pdf' });
    vi.stubGlobal('confirm', vi.fn(() => true));
    const changed = vi.fn();
    render(<CashAndGraceCard facilities={[PAID]} onChanged={changed} />);
    fireEvent.change(screen.getByLabelText('Facility'), { target: { value: 'c1' } });
    fireEvent.change(screen.getByLabelText('How it was paid'), { target: { value: 'MOBILE_MONEY' } });
    fireEvent.change(screen.getByLabelText('Paid by'), { target: { value: 'Okello Isaac, 0772 340 349' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(screen.getByRole('alert').textContent).toBe('Choose the mobile money network');
    fireEvent.change(screen.getByLabelText('Network'), { target: { value: 'MTN Mobile Money' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Enter the transaction id/);
    fireEvent.change(screen.getByLabelText(/Transaction ID/), { target: { value: 'MP231123.1045.A1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    expect(body(fetchMock)).toMatchObject({ method: 'MOBILE_MONEY', provider: 'MTN Mobile Money', reference: 'MP231123.1045.A1', amount: 100000, months: 1 });
    expect(screen.getByRole('status').textContent).toMatch(/UGX 100,000 by MTN Mobile Money from Gulu Family Clinic is recorded/);
  });

  it('lists Pesapal payments waiting to be confirmed, and confirms one by hand', async () => {
    const waiting = { id: 'pay-9', clinicId: 'c1', amount: 100000, currency: 'UGX', months: 1, createdAt: at(-1), pesapalOrderTrackingId: 'TRK-9' };
    const fetchMock = server({ paidUntil: '2026-12-17T09:00:00Z', receiptPath: '/billing/receipts/pay-9/pdf' }, [waiting]);
    vi.stubGlobal('confirm', vi.fn(() => true));
    const changed = vi.fn();
    render(<CashAndGraceCard facilities={[PAID]} onChanged={changed} />);
    const list = await screen.findByTestId('pesapal-waiting');
    expect(list.textContent).toMatch(/Gulu Family Clinic - UGX 100,000/);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm by hand' }));
    expect((screen.getByLabelText('How it was paid') as HTMLSelectElement).value).toBe('PESAPAL');
    expect((screen.getByLabelText('The Pesapal payment') as HTMLSelectElement).value).toBe('pay-9');
    fireEvent.change(screen.getByLabelText('Paid by'), { target: { value: 'Okello Isaac' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    expect(url(fetchMock)).toMatch(/\/billing\/manual\/c1$/);
    expect(body(fetchMock)).toMatchObject({ method: 'PESAPAL', pesapalPaymentId: 'pay-9', amount: 100000, paidBy: 'Okello Isaac' });
  });
});
