'use client';

import { useState } from 'react';
import { CheckCircle2, FileText, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * Emails one of every document Bulamu produces - made-up details, stamped
 * SAMPLE on every page - to the operator inbox, for checking branding and
 * layout without opening anyone's records.
 */
export function SampleDocumentsCard({ inbox }: { inbox: string }) {
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<{ sent: boolean; message: string } | null>(null);

  const send = async () => {
    setSending(true);
    setOutcome(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/super-admin/system/sample-documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      setOutcome(
        data.result?.sent
          ? { sent: true, message: `${data.documents.length} sample documents sent to ${inbox}.` }
          : { sent: false, message: `Not sent: ${data.result?.reason || 'unknown reason'}` }
      );
    } catch (e: any) {
      setOutcome({ sent: false, message: e.message || 'Request failed' });
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="p-4 gap-3" data-testid="sample-documents">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Sample documents</h3>
          <p className="text-xs text-muted-foreground">
            Emails one of every document Bulamu produces - invoices, prescription, referral letter, discharge summary and both
            receipts - to <strong className="text-foreground">{inbox}</strong>. They use made-up details and are stamped SAMPLE on every page.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={send} disabled={sending}>
          <FileText className="h-4 w-4 mr-1" aria-hidden />{sending ? 'Sending...' : 'Send sample documents'}
        </Button>
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
