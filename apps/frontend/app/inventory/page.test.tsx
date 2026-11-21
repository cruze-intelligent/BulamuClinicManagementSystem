import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// This device's stock, kept the way lib/local-first keeps it: saving a list is a change.
const local = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const store = new Map<string, any>();
  const emit = () => listeners.forEach((l) => l());
  return {
    store,
    listInventory: async () => [...store.values()].filter((m) => !m.deletedAt),
    cache: async (items: any[]) => {
      for (const m of items) (m.deletedAt ? store.delete(m.id) : store.set(m.id, m));
      emit();
    },
    replace: async (_clinicId: string, items: any[]) => {
      store.clear();
      for (const m of items) store.set(m.id, m);
      emit();
    },
    subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); },
  };
});
vi.mock('@/lib/local-first', () => ({
  getCurrentClinicId: () => 'c1',
  listLocalInventory: local.listInventory,
  cacheInventory: local.cache,
  replaceInventory: local.replace,
  addMedicineOffline: vi.fn(),
  subscribeToLocalChanges: local.subscribe,
}));
vi.mock('@/lib/useAuth', () => ({ useAuth: () => ({ hasRole: () => true }) }));

import InventoryPage from './page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  local.store.clear();
});

const ARTESUNATE = { id: 'm1', clinicId: 'c1', name: 'Artesunate 60 mg injection', quantity: 18, unit: 'vials', reorderLevel: 10, price: 2000, expiredQuantity: 0, batches: [], updatedAt: '2026-11-20T10:00:00.000Z' };
const reply = (body: object) => ({ ok: true, json: async () => body });

describe('the stock list', () => {
  it('asks the server once, and a list on its way during an edit does not put the old price back', async () => {
    local.store.set('m1', ARTESUNATE);
    let listArrives: (value: unknown) => void = () => {};
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return Promise.resolve(reply({ success: true, medicine: { ...ARTESUNATE, price: 2500, updatedAt: '2026-11-21T08:00:00.000Z' } }));
      // The stock list, slow to come (a weak connection): it left the server before the edit.
      return new Promise((resolve) => { listArrives = () => resolve(reply({ success: true, medicines: [ARTESUNATE] })); });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<InventoryPage />);
    await screen.findByText('UGX 2,000');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Price per vial (UGX)'), { target: { value: '2500' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await screen.findByText('UGX 2,500');

    await act(async () => listArrives(undefined));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText('UGX 2,500')).toBeTruthy();
    // One look at the server's list - saving it no longer asks for it again, and again.
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith('/inventory/c1') && !init?.method)).toHaveLength(1);
  });

  it('a discontinued item stays off the list when an older list arrives', async () => {
    local.store.set('m1', ARTESUNATE);
    let listArrives: (value: unknown) => void = () => {};
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return Promise.resolve(reply({ success: true, medicine: { ...ARTESUNATE, deletedAt: '2026-11-21T08:00:00.000Z' } }));
      return new Promise((resolve) => { listArrives = () => resolve(reply({ success: true, medicines: [ARTESUNATE] })); });
    }));
    vi.stubGlobal('prompt', () => '');

    render(<InventoryPage />);
    await screen.findByText('Artesunate 60 mg injection');
    fireEvent.click(screen.getByRole('button', { name: 'Discontinue' }));
    await screen.findByText('Artesunate 60 mg injection is off the stock list.');
    await act(async () => listArrives(undefined));
    await new Promise((r) => setTimeout(r, 50));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Artesunate 60 mg injection' })).toBeNull());
  });
});
