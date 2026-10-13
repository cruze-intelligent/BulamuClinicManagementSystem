'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileDown } from 'lucide-react';
import { useAuth } from '@/lib/useAuth';

type Invoice = {
  id: string;
  amount: number;
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  createdAt: string;
  paidAt: string | null;
  consultation: { diagnosis: string; patient: { name: string }; appointment: { doctor?: { name: string } | null } };
};

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'PENDING', label: 'Unpaid' },
  { value: 'PAID', label: 'Paid' },
  { value: 'CANCELLED', label: 'Cancelled' },
] as const;

const STATUS_LABEL: Record<Invoice['status'], string> = { PENDING: 'Unpaid', PAID: 'Paid', CANCELLED: 'Cancelled' };
const STATUS_STYLE: Record<Invoice['status'], string> = {
  PENDING: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
  PAID: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  CANCELLED: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
};

const ugx = (amount: number) => `UGX ${amount.toLocaleString()}`;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default function InvoicesPage() {
  const { hasRole } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['value']>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchInvoices = async () => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/invoices/${user.clinicId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await response.json();
      if (data.success) setInvoices(data.invoices);
    } catch {
      setError(navigator.onLine ? 'Could not load invoices - please try again.' : 'You are offline. Invoices load when the connection returns.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoices();
  }, []);

  const act = async (id: string, action: 'pay' | 'cancel', confirmText: string) => {
    if (!confirm(confirmText)) return;
    setBusyId(id);
    setError('');
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/invoices/${id}/${action}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not update the invoice');
      await fetchInvoices();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const downloadPdf = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/invoices/${id}/pdf`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      if (!res.ok) throw new Error('Failed to generate PDF');
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `invoice-${id.slice(0, 8)}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Could not download the invoice PDF - please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const outstanding = invoices.filter((i) => i.status === 'PENDING');
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const collectedThisMonth = invoices.filter((i) => i.status === 'PAID' && i.paidAt && new Date(i.paidAt) >= monthStart);
  const shown = filter === 'all' ? invoices : invoices.filter((i) => i.status === filter);
  const canTakePayment = hasRole('ADMIN', 'DOCTOR');

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8 dark:bg-slate-950">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-3xl font-bold">Invoices</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Your facility&apos;s bills to patients. Your facility collects the money; Bulamu keeps the record.
          A fee entered when recording a consultation appears here.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Card className="p-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">Outstanding</p>
            <p className="text-2xl font-bold tabular-nums">{ugx(outstanding.reduce((s, i) => s + i.amount, 0))}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{outstanding.length} unpaid invoice{outstanding.length === 1 ? '' : 's'}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">Collected this month</p>
            <p className="text-2xl font-bold tabular-nums">{ugx(collectedThisMonth.reduce((s, i) => s + i.amount, 0))}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{collectedThisMonth.length} paid</p>
          </Card>
        </div>

        <div className="mb-4 mt-6 flex flex-wrap gap-2" role="group" aria-label="Show invoices">
          {FILTERS.map((f) => (
            <Button key={f.value} size="sm" variant={filter === f.value ? 'default' : 'outline'} onClick={() => setFilter(f.value)} aria-pressed={filter === f.value}>
              {f.label}
            </Button>
          ))}
        </div>

        {error && <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

        {loading ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : shown.length === 0 ? (
          <Card className="p-6 text-sm text-slate-600 dark:text-slate-400">
            {invoices.length === 0
              ? 'No invoices yet. When a clinician records a consultation with a fee, the invoice appears here to be marked paid and printed.'
              : 'No invoices in this view.'}
          </Card>
        ) : (
          <div className="space-y-3">
            {shown.map((invoice) => (
              <Card key={invoice.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{invoice.consultation.patient.name}</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {invoice.consultation.diagnosis}
                      {invoice.consultation.appointment.doctor?.name ? ` · ${invoice.consultation.appointment.doctor.name}` : ''}
                    </p>
                    <p className="mt-2 text-lg font-bold tabular-nums">{ugx(invoice.amount)}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {day(invoice.createdAt)}{invoice.paidAt ? ` · paid ${day(invoice.paidAt)}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-2 py-1 text-xs font-medium ${STATUS_STYLE[invoice.status]}`}>{STATUS_LABEL[invoice.status]}</span>
                    <Button size="sm" variant="outline" disabled={busyId === invoice.id} onClick={() => downloadPdf(invoice.id)} title="Download the invoice as a PDF">
                      <FileDown className="size-4" aria-hidden="true" /> PDF
                    </Button>
                    {invoice.status === 'PENDING' && canTakePayment && (
                      <Button size="sm" disabled={busyId === invoice.id} onClick={() => act(invoice.id, 'pay', `Mark ${ugx(invoice.amount)} from ${invoice.consultation.patient.name} as paid?`)}>
                        Mark paid
                      </Button>
                    )}
                    {invoice.status === 'PENDING' && hasRole('ADMIN') && (
                      <Button size="sm" variant="outline" disabled={busyId === invoice.id} onClick={() => act(invoice.id, 'cancel', `Cancel this ${ugx(invoice.amount)} invoice? Use this for a fee charged by mistake or waived. It is kept, marked cancelled.`)}>
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
