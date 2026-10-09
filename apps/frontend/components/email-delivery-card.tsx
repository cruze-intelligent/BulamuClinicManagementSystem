'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Mail, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { timeAgo } from '@/lib/analytics-format';

export type MailStatus = {
  configured: boolean;
  mode: string;
  route: string;
  relayUrl: string;
  operatorInbox: string;
  recent: Array<{ at: string; to: string; subject: string; sent: boolean; via?: string; reason?: string }>;
  recentSent: number;
  recentFailed: number;
};

/**
 * Whether platform email is actually going out: where operator alerts go, the
 * route in use, the last deliveries (since the server started), and a button
 * that sends a test email to the operator inbox and shows exactly what happened.
 */
export function EmailDeliveryCard({ initial }: { initial: MailStatus }) {
  const [mail, setMail] = useState(initial);
  const [testing, setTesting] = useState(false);
  const [outcome, setOutcome] = useState<{ sent: boolean; reason?: string; via?: string } | null>(null);

  const sendTest = async () => {
    setTesting(true);
    setOutcome(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/super-admin/system/test-email`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      setOutcome(data.result);
      setMail(data.mail);
    } catch (e: any) {
      setOutcome({ sent: false, reason: e.message || 'Request failed' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className="p-4 gap-3" data-testid="email-delivery">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Email delivery</h3>
          <p className="text-xs text-muted-foreground">
            Platform alerts (registrations, approvals, payments, suspensions, feedback) go to <strong className="text-foreground">{mail.operatorInbox}</strong>.
            Route: {mail.route}. The list below covers emails since the server last started.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={sendTest} disabled={testing || !mail.configured}>
          <Mail className="h-4 w-4 mr-1" aria-hidden />{testing ? 'Sending...' : 'Send test email'}
        </Button>
      </div>

      {!mail.configured && (
        <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />Email is not configured on the server (SMTP settings are missing), so no emails can be sent.
        </p>
      )}

      {outcome && (
        <p role="status" className={`text-sm flex items-start gap-1.5 ${outcome.sent ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
          {outcome.sent ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" aria-hidden /> : <XCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />}
          {outcome.sent
            ? `Test email handed to the mail server${outcome.via === 'relay' ? ' (through the website mail bridge)' : ''}. Check ${mail.operatorInbox}, including the spam folder.`
            : `Test email failed: ${outcome.reason}`}
        </p>
      )}

      {mail.recent.length === 0 ? (
        <p className="text-xs text-muted-foreground">No emails sent since the server started.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr><th className="text-left font-normal py-1 pr-3">When</th><th className="text-left font-normal py-1 pr-3">Email</th><th className="text-left font-normal py-1 pr-3">To</th><th className="text-left font-normal py-1">Result</th></tr>
            </thead>
            <tbody>
              {mail.recent.map((d, i) => (
                <tr key={`${d.at}-${i}`} className="border-t align-top">
                  <td className="py-1 pr-3 whitespace-nowrap text-muted-foreground">{timeAgo(d.at)}</td>
                  <td className="py-1 pr-3">{d.subject}</td>
                  <td className="py-1 pr-3 break-all">{d.to}</td>
                  <td className="py-1">
                    {d.sent
                      ? <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />Sent{d.via === 'relay' ? ' (bridge)' : ''}</span>
                      : <span className="inline-flex items-start gap-1 text-red-700 dark:text-red-400"><XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />Failed: {d.reason}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
