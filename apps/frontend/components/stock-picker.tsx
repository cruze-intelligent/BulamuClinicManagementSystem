'use client';

import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { getCurrentClinicId, listLocalInventory, type LocalMedicine } from '@/lib/local-first';

export type StockChoice = Pick<LocalMedicine, 'id' | 'name' | 'quantity' | 'unit' | 'price' | 'expiredQuantity'>;

/** What can be sold now: on the shelf and in date. */
export const sellable = (item: StockChoice) => Math.max(0, item.quantity - (item.expiredQuantity ?? 0));

/** The facility's stock list, freshest available (the server's, or this device's copy offline). */
export function useStockList(): StockChoice[] {
  const [items, setItems] = useState<StockChoice[]>([]);
  useEffect(() => {
    const clinicId = getCurrentClinicId();
    if (!clinicId) return;
    let cancelled = false;
    void listLocalInventory(clinicId).then((local) => !cancelled && setItems(local));
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/inventory/${clinicId}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then((res) => res.json())
      .then((data) => { if (!cancelled && data.success && Array.isArray(data.medicines)) setItems(data.medicines); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return items;
}

/**
 * Sell a medicine from stock: picking it fills in the name and price, and the
 * quantity sold comes off the shelf when the bill is saved. Expired stock is
 * never offered.
 */
export function StockPicker({ id, items, value, onPick }: { id: string; items: StockChoice[]; value: string; onPick: (item: StockChoice | null) => void }) {
  if (!items.length) return null;
  return (
    <div>
      <Label htmlFor={id} className="text-xs">From stock</Label>
      <Select id={id} value={value} onChange={(e) => onPick(items.find((i) => i.id === e.target.value) ?? null)}>
        <option value="">Not from stock (type it below)</option>
        {items.map((item) => (
          <option key={item.id} value={item.id} disabled={sellable(item) <= 0}>
            {item.name} - {sellable(item) > 0 ? `${sellable(item).toLocaleString('en-US')} ${item.unit} in stock` : 'none in date'} - UGX {Math.round(item.price).toLocaleString('en-US')}
          </option>
        ))}
      </Select>
    </div>
  );
}
