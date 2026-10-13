'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Invoice = { id: string; amount: number; status: 'PENDING' | 'PAID' | 'CANCELLED' };

const STATUS: Record<Invoice['status'], { label: string; style: string }> = {
  PENDING: { label: 'Unpaid', style: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300' },
  PAID: { label: 'Paid', style: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300' },
  CANCELLED: { label: 'Cancelled', style: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
};

/**
 * A consultation's fee - the facility's invoice to the patient - or, for one
 * recorded without a fee, a way to add it (administrators and doctors).
 */
export function ConsultationFee({ consultationId, invoice, canCharge }: { consultationId: string; invoice: Invoice | null; canCharge: boolean }) {
  const [current, setCurrent] = useState<Invoice | null>(invoice);
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!current && !canCharge) return null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ consultationId, amount }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not add the fee');
      setCurrent(data.invoice);
      setAdding(false);
    } catch (err: any) {
      setError(navigator.onLine ? err.message : 'You are offline - add the fee when the connection returns.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t pt-4 text-sm">
      {current ? (
        <p>
          <strong>Fee:</strong> UGX {current.amount.toLocaleString()}
          <span className={`ml-2 rounded px-2 py-1 text-xs font-medium ${STATUS[current.status].style}`}>{STATUS[current.status].label}</span>
        </p>
      ) : adding ? (
        <form onSubmit={save} className="flex flex-wrap items-center gap-2" aria-label="Add a fee for this consultation">
          <span className="text-slate-500 dark:text-slate-400">UGX</span>
          <Input
            aria-label="Fee in UGX"
            inputMode="numeric"
            className="w-36"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
            required
            autoFocus
          />
          <Button type="submit" size="sm" disabled={busy || !amount}>{busy ? 'Saving...' : 'Add fee'}</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(false)} disabled={busy}>Cancel</Button>
          {error && <p role="alert" className="w-full text-red-600">{error}</p>}
        </form>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>Add fee</Button>
      )}
    </div>
  );
}
