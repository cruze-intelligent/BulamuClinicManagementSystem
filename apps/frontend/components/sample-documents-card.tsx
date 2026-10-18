'use client';

import { useState } from 'react';
import { CheckCircle2, FileText, Mail, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * Emails samples to the operator inbox for checking without opening anyone's
 * records: one of every document Bulamu produces (made-up details, stamped
 * SAMPLE on every page), or one of every email it sends.
 */
export function SampleDocumentsCard({ inbox }: { inbox: string }) {
  const [sending, setSending] = useState<'documents' | 'emails' | null>(null);
  const [outcome, setOutcome] = useState<{ sent: boolean; message: string } | null>(null);

  const send = async (kind: 'documents' | 'emails') => {
    setSending(kind);
    setOutcome(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/super-admin/system/sample-${kind}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      if (kind === 'documents') {
        setOutcome(
          data.result?.sent
            ? { sent: true, message: `${data.documents.length} sample documents sent to ${inbox}.` }
            : { sent: false, message: `Not sent: ${data.result?.reason || 'unknown reason'}` }
        );
      } else {
        setOutcome(
          data.sent === data.total
            ? { sent: true, message: `${data.total} sample emails sent to ${inbox}, one per message.` }
            : { sent: false, message: `${data.sent} of ${data.total} sample emails sent${data.reason ? ` - ${data.reason}` : ''}.` }
        );
      }
    } catch (e: any) {
      setOutcome({ sent: false, message: e.message || 'Request failed' });
    } finally {
      setSending(null);
    }
  };

  return (
    <Card className="p-4 gap-3" data-testid="sample-documents">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h3 className="text-sm font-medium">Samples for checking</h3>
          <p className="text-xs text-muted-foreground">
            Sends to <strong className="text-foreground">{inbox}</strong>, with made-up details: one of every document Bulamu
            produces (invoices, prescription, referral letter, discharge summary and both receipts, stamped SAMPLE on every page),
            or one of every email it sends (with &quot;[Sample]&quot; in the subject).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => send('documents')} disabled={!!sending}>
            <FileText className="h-4 w-4 mr-1" aria-hidden />{sending === 'documents' ? 'Sending...' : 'Send sample documents'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => send('emails')} disabled={!!sending}>
            <Mail className="h-4 w-4 mr-1" aria-hidden />{sending === 'emails' ? 'Sending...' : 'Send sample emails'}
          </Button>
        </div>
      </div>
      {outcome && (
        <p role="status" className={`flex items-start gap-1.5 text-sm ${outcome.sent ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
          {outcome.sent ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />}
          {outcome.message}
        </p>
      )}
    </Card>
  );
}
