'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileDown } from 'lucide-react';

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    fetchInvoices();
  }, [filter]);

  const fetchInvoices = async () => {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    try {
      const url = filter === 'all' 
        ? `${process.env.NEXT_PUBLIC_API_URL}/invoices/${user.clinicId}`
        : `${process.env.NEXT_PUBLIC_API_URL}/invoices/${user.clinicId}?status=${filter.toUpperCase()}`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const data = await response.json();
      if (data.success) setInvoices(data.invoices);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const markAsPaid = async (id: string) => {
    const token = localStorage.getItem('token');

    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/invoices/${id}/pay`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` }
      });

      fetchInvoices();
    } catch (error) {
      alert('Error marking invoice as paid');
    }
  };

  const downloadPdf = async (id: string) => {
    const token = localStorage.getItem('token');
    setDownloadingId(id);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/invoices/${id}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to generate PDF');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `invoice-${id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert('Error downloading invoice PDF');
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="min-h-screen p-8 bg-slate-50 dark:bg-slate-950">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Invoices</h1>

        <div className="flex gap-2 mb-6">
          <Button 
            variant={filter === 'all' ? 'default' : 'outline'}
            onClick={() => setFilter('all')}
          >
            All
          </Button>
          <Button 
            variant={filter === 'pending' ? 'default' : 'outline'}
            onClick={() => setFilter('pending')}
          >
            Pending
          </Button>
          <Button 
            variant={filter === 'paid' ? 'default' : 'outline'}
            onClick={() => setFilter('paid')}
          >
            Paid
          </Button>
        </div>

        {loading ? (
          <p>Loading...</p>
        ) : (
          <div className="space-y-3">
            {invoices.map((invoice: any) => (
              <Card key={invoice.id} className="p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-semibold">{invoice.consultation.patient.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {invoice.consultation.diagnosis}
                    </p>
                    <p className="text-sm">
                      Dr. {invoice.consultation.appointment.doctor.name}
                    </p>
                    <p className="text-lg font-bold mt-2">
                      UGX {invoice.amount.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(invoice.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2 items-center">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={downloadingId === invoice.id}
                      onClick={() => downloadPdf(invoice.id)}
                      title="Download branded PDF"
                    >
                      <FileDown className="size-4" aria-hidden="true" />
                      {downloadingId === invoice.id ? 'Preparing...' : 'PDF'}
                    </Button>
                    {invoice.status === 'PENDING' && (
                      <Button size="sm" onClick={() => markAsPaid(invoice.id)}>
                        Mark Paid
                      </Button>
                    )}
                    <span className={`text-xs px-2 py-1 rounded ${
                      invoice.status === 'PAID' ? 'bg-green-100 dark:bg-green-900' : 'bg-yellow-100 dark:bg-yellow-900'
                    }`}>
                      {invoice.status}
                    </span>
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