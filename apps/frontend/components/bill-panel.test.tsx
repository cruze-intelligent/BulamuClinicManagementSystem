import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BillPanel, type Bill } from './bill-panel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const bill = (over: Partial<Bill> = {}): Bill => ({
  id: 'bill-1', clinicId: 'c1', consultationId: 'v1', amount: 26000, amountPaid: 0, balance: 26000, status: 'PENDING', state: 'Unpaid',
  createdAt: '2026-10-18T07:00:00Z', paidAt: null,
  patient: { id: 'p1', name: 'Achieng Mary', phone: '0772 123 456', email: null },
  consultation: { id: 'v1', diagnosis: 'Malaria', appointment: { doctor: { name: 'Dr Okello' } } },
  items: [{ id: 'i1', kind: 'CONSULTATION', description: 'Consultation', quantity: 1, unitPrice: 20000, amount: 20000 },
    { id: 'i2', kind: 'MEDICINE', description: 'Artemether/Lumefantrine 20/120 mg', quantity: 24, unitPrice: 250, amount: 6000 }],
  payments: [],
  ...over,
});

/** A fake server: answers by path, and records what was sent. */
function server(routes: Record<string, (body: any) => unknown>) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace(/^.*?(\/(invoices|payments)\/)/, '$1');
    const key = `${init.method ?? 'GET'} ${path}`;
    const handler = Object.entries(routes).find(([pattern]) => key.startsWith(pattern))?.[1];
    const body = handler ? handler(init.body ? JSON.parse(String(init.body)) : undefined) : { success: false, error: `no route ${key}` };
    return { ok: (body as any).success !== false, json: async () => body };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('a bill', () => {
  it('shows its charges and balance, and suggests what the visit could still add', async () => {
    server({
      'GET /invoices/detail/bill-1': () => ({
        success: true, invoice: bill(),
        suggestions: [{ kind: 'LAB', description: 'Malaria RDT', quantity: 1, unitPrice: 5000, labTestId: 'lab-1' }, { kind: 'ADMISSION', description: 'Female Ward - ward stay (per night)', quantity: 2, unitPrice: null, admissionId: 'a1' }],
      }),
    });
    render(<BillPanel billId="bill-1" clinicName="Mbarara Family Clinic" isAdmin={false} onClose={() => {}} onChanged={() => {}} />);
    expect(await screen.findByText('Artemether/Lumefantrine 20/120 mg')).toBeTruthy();
    expect(screen.getByText('Medicine · 24 × 250')).toBeTruthy();
    expect(screen.getAllByText('UGX 26,000').length).toBeGreaterThan(0);
    expect(screen.getByText('Not on the bill yet')).toBeTruthy();
    expect((screen.getByLabelText('Price for Malaria RDT') as HTMLInputElement).value).toBe('5000');
    expect((screen.getByLabelText('Price for Female Ward - ward stay (per night), each') as HTMLInputElement).value).toBe('');
    // Patients never pay here: staff record what the facility received.
    expect(screen.getByRole('heading', { name: 'Record a payment' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Void/ })).toBeNull();
  });

  it('records a part payment with its method and reference, then offers the receipt by print, email, SMS and WhatsApp', async () => {
    const changed = vi.fn();
    const paid = bill({
      amountPaid: 10000, balance: 16000, state: 'Part paid',
      payments: [{ id: 'pay-1', receiptNumber: '000042', amount: 10000, method: 'MOBILE_MONEY', reference: 'MP123', payerName: null, receivedAt: '2026-10-18T07:05:00Z', receivedBy: { name: 'Sarah Nakato', role: 'STAFF' }, voidedAt: null, voidReason: null }],
    });
    const fetchMock = server({
      'GET /invoices/detail/bill-1': () => ({ success: true, invoice: bill(), suggestions: [] }),
      'POST /invoices/bill-1/payments': () => ({ success: true, invoice: paid, payment: paid.payments[0] }),
    });
    render(<BillPanel billId="bill-1" clinicName="Mbarara Family Clinic" isAdmin={false} onClose={() => {}} onChanged={changed} />);
    await screen.findByText('Artemether/Lumefantrine 20/120 mg');

    expect((screen.getByLabelText('Amount received (UGX)') as HTMLInputElement).value).toBe('26000');
    fireEvent.click(screen.getByLabelText('Mobile money'));
    fireEvent.change(screen.getByLabelText('Transaction ID'), { target: { value: 'MP123' } });
    fireEvent.change(screen.getByLabelText('Amount received (UGX)'), { target: { value: '10,000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record UGX 10,000 received' }));

    await waitFor(() => expect(screen.getByText('UGX 10,000 received - receipt 000042')).toBeTruthy());
    const sent = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/payments') && init?.method === 'POST')!;
    expect(JSON.parse(String(sent[1]!.body))).toEqual({ amount: 10000, method: 'MOBILE_MONEY', reference: 'MP123' });
    expect(changed).toHaveBeenCalled();
    expect(screen.getByText(/UGX 16,000 is still owed/)).toBeTruthy();

    const sms = screen.getByRole('link', { name: /SMS/ }).getAttribute('href')!;
    expect(sms.startsWith('sms:+256772123456?body=')).toBe(true);
    expect(decodeURIComponent(sms)).toContain('receipt 000042 for Achieng Mary. UGX 10,000 received by mobile money');
    expect(screen.getByRole('link', { name: /WhatsApp/ }).getAttribute('href')).toMatch(/^https:\/\/wa\.me\/256772123456\?text=/);
    expect(screen.getByRole('button', { name: 'Print receipt' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Print receipt 000042' })).toBeTruthy();
  });

  it('refuses an amount that is not whole shillings before sending anything', async () => {
    const fetchMock = server({ 'GET /invoices/detail/bill-1': () => ({ success: true, invoice: bill(), suggestions: [] }) });
    render(<BillPanel billId="bill-1" clinicName="Clinic" isAdmin={false} onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('Artemether/Lumefantrine 20/120 mg');
    fireEvent.change(screen.getByLabelText('Amount received (UGX)'), { target: { value: '12.5' } });
    fireEvent.submit(screen.getByLabelText('Amount received (UGX)').closest('form')!);
    expect(screen.getByRole('alert').textContent).toBe('Enter the amount received, in whole shillings');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lets an administrator void a payment, with a reason', async () => {
    const withPayment = bill({
      amountPaid: 26000, balance: 0, status: 'PAID', state: 'Paid',
      payments: [{ id: 'pay-1', receiptNumber: '000007', amount: 26000, method: 'CASH', reference: null, payerName: null, receivedAt: '2026-10-18T07:05:00Z', receivedBy: null, voidedAt: null, voidReason: null }],
    });
    const fetchMock = server({
      'GET /invoices/detail/bill-1': () => ({ success: true, invoice: withPayment, suggestions: [] }),
      'POST /payments/pay-1/void': () => ({ success: true, invoice: bill() }),
    });
    vi.stubGlobal('prompt', vi.fn(() => 'Wrong patient'));
    render(<BillPanel billId="bill-1" clinicName="Clinic" isAdmin onClose={() => {}} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Void receipt 000007' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/payments/pay-1/void'))).toBe(true));
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/void'))!;
    expect(JSON.parse(String(call[1]!.body))).toEqual({ reason: 'Wrong patient' });
    // The payment form is back: the bill is owed again.
    expect(await screen.findByRole('heading', { name: 'Record a payment' })).toBeTruthy();
  });
});
