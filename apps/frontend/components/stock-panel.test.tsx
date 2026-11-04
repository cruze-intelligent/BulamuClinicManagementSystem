import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StockPanel } from './stock-panel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ITEM = { id: 'med-1', name: 'Amoxicillin 500 mg', quantity: 50, unit: 'capsules', reorderLevel: 10, price: 200, expiredQuantity: 0 };

function server(reply: object = { success: true, medicine: { ...ITEM, quantity: 47 } }) {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => reply }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('the stock panel', () => {
  it('records a count - a difference needs a reason, and the panel says what it will change', async () => {
    const fetchMock = server();
    const changed = vi.fn();
    render(<StockPanel item={ITEM} mode="count" canChange onClose={() => {}} onChanged={changed} />);
    fireEvent.change(screen.getByLabelText('Counted (capsules)'), { target: { value: '47' } });
    expect(screen.getByRole('status').textContent).toBe('3 capsules fewer than recorded (50).');
    fireEvent.click(screen.getByRole('button', { name: 'Record the count' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Say why the count differs/);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Why it differs'), { target: { value: 'Three missing at month-end' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record the count' }));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/inventory\/med-1\/count$/);
    expect(JSON.parse(String(init.body))).toEqual({ counted: 47, note: 'Three missing at month-end' });
  });

  it('removes stock only with a reason, and never more than is on the shelf', async () => {
    const fetchMock = server();
    render(<StockPanel item={ITEM} mode="remove" canChange onClose={() => {}} onChanged={() => {}} />);
    fireEvent.change(screen.getByLabelText('Quantity removed (capsules)'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove from stock' }));
    expect(screen.getByRole('alert').textContent).toBe('Choose why the stock is being removed');
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'DAMAGED' } });
    fireEvent.change(screen.getByLabelText('Quantity removed (capsules)'), { target: { value: '51' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove from stock' }));
    expect(screen.getByRole('alert').textContent).toBe('Only 50 capsules are on the shelf');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offers to remove expired stock straight away, already filled in', () => {
    server();
    render(<StockPanel item={{ ...ITEM, expiredQuantity: 20 }} mode="remove" canChange onClose={() => {}} onChanged={() => {}} />);
    expect((screen.getByLabelText('Why') as HTMLSelectElement).value).toBe('EXPIRED');
    expect((screen.getByLabelText('Quantity removed (capsules)') as HTMLInputElement).value).toBe('20');
  });

  it('lets only pharmacists and administrators change stock', () => {
    server();
    render(<StockPanel item={ITEM} mode="receive" canChange={false} onClose={() => {}} onChanged={() => {}} />);
    expect(screen.getByText('Only pharmacists and administrators change stock.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add to stock' })).toBeNull();
  });
});
