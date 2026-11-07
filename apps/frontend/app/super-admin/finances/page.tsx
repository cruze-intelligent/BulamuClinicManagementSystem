'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, Download, Hourglass, Loader2, RefreshCw, Wallet } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/useAuth';
import { downloadWithAuth } from '@/lib/download';
import { BarList, StatTile, TimeSeriesChart } from '@/components/analytics-charts';
import { compactNumber } from '@/lib/analytics-format';
import { kampalaToday, shortDate } from '@/lib/finance';
import { STANDING_LABELS, count, monthLabel, paymentStatusLabel, periodText, receivedChange } from '@/lib/platform-finances';

type Facility = {
  id: string; name: string; facilityCode: string; isActive: boolean; plan: 'STANDARD' | 'CUSTOM'; status: string;
  standing: keyof typeof STANDING_LABELS; amount: number; currency: string; coveredUntil: string | null; lastPaymentAt: string | null;
  totalPaid: number; payments: number;
};
type Payment = {
  id: string; facility: { id: string; name: string; facilityCode: string }; amount: number; currency: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REVERSED'; startedAt: string; paidAt: string | null;
  periodStart: string | null; periodEnd: string | null; reference: string | null; hasReceipt: boolean;
  method?: 'PESAPAL' | 'CASH'; paidBy?: string | null;
};
type Bucket = { amount: number; payments: number };
type Finances = {
  currency: string;
  months: { thisMonth: string; lastMonth: string };
  received: { thisMonth: Bucket; lastMonth: Bucket; thisYear: Bucket; allTime: Bucket; reversed: Bucket; pendingCheckouts: number };
  monthlyRecurring: { amount: number; facilities: number };
  expected: {
    dueSoon: { days: number; amount: number; facilities: Facility[] };
    overdue: { amount: number; facilities: Facility[] };
    trialsEnding: { days: number; amount: number; facilities: Facility[] };
  };
  monthly: Array<{ month: string; amount: number; payments: number }>;
  facilities: Facility[];
  payments: Payment[];
  paymentsShown: number;
};

const API = process.env.NEXT_PUBLIC_API_URL;
const money = (n: number) => `UGX ${Math.round(n).toLocaleString('en-US')}`;

const STANDING_TONES: Record<string, string> = {
  PAID: 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900',
  TRIAL: 'bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900',
  OVERDUE: 'bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900',
  CANCELLED: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
};

/**
 * Bulamu's own money: the subscriptions facilities pay through Pesapal.
 * Facilities' patient money is theirs and never appears here.
 */
export default function SuperAdminFinancesPage() {
  const { hasRole } = useAuth();
  const isOperator = hasRole('SUPER_ADMIN');
  const [data, setData] = useState<Finances | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/super-admin/finances`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not load the finances - please try again.');
      setData(body.finances);
      setError('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOperator) void load();
  }, [isOperator, load]);

  const download = async (key: string, url: string, filename: string) => {
    setDownloading(key);
    try {
      await downloadWithAuth(url, localStorage.getItem('token'), filename);
    } catch (e: any) {
      setError(e.message || 'The download failed - please try again.');
    } finally {
      setDownloading(null);
    }
  };

  if (!isOperator) return null;

  return (
    <main className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold uppercase text-emerald-700">
            <Wallet className="size-4" aria-hidden="true" />
            Platform administration
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">Finances</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
            Bulamu&apos;s own income: the subscriptions facilities pay through Pesapal. Facilities&apos; patient money is theirs and never appears
            here. Months are East Africa Time; demo facilities never count.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh
          </Button>
          <Button size="sm" disabled={downloading === 'csv'} onClick={() => download('csv', `${API}/super-admin/finances/payments.csv`, `bulamu-subscription-payments-${kampalaToday()}.csv`)}>
            {downloading === 'csv' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
            All payments (spreadsheet)
          </Button>
        </div>
      </header>

      {error && <Card className="p-4 text-sm text-red-700 dark:text-red-400" role="alert">{error}</Card>}
      {!data && loading && <p className="text-sm text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" aria-hidden="true" />Loading...</p>}

      {data && (
        <div className={`space-y-6 ${loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}`} aria-busy={loading}>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" aria-label="Headline figures">
            <StatTile
              label={`Received in ${monthLabel(data.months.thisMonth, 'long')}`} value={compactNumber(data.received.thisMonth.amount)}
              change={receivedChange(data.received.thisMonth.amount, data.received.lastMonth.amount)}
              hint={count(data.received.thisMonth.payments, 'payment')}
            />
            <StatTile label={`Received in ${monthLabel(data.months.lastMonth, 'long')}`} value={compactNumber(data.received.lastMonth.amount)} hint={count(data.received.lastMonth.payments, 'payment')} />
            <StatTile label="This year" value={compactNumber(data.received.thisYear.amount)} hint={count(data.received.thisYear.payments, 'payment')} />
            <StatTile label="Monthly recurring" value={compactNumber(data.monthlyRecurring.amount)} hint={count(data.monthlyRecurring.facilities, 'paying facility', 'paying facilities')} />
            <StatTile label="Overdue" value={compactNumber(data.expected.overdue.amount)} hint={count(data.expected.overdue.facilities.length, 'facility', 'facilities')} />
            <StatTile label="Received in all" value={compactNumber(data.received.allTime.amount)} hint={count(data.received.allTime.payments, 'payment')} />
          </section>

          <section className="grid gap-4 lg:grid-cols-2" aria-label="Income">
            <TimeSeriesChart
              title={`Received each month (${data.currency})`}
              points={data.monthly.map((m) => ({ date: m.month, value: m.amount }))}
              label={(month) => monthLabel(month, 'short')}
              period="in the last 12 months"
            />
            <BarList
              title={`Paid in all, by facility (${data.currency})`}
              rows={[...data.facilities].filter((f) => f.totalPaid > 0).sort((a, b) => b.totalPaid - a.totalPaid).slice(0, 8)
                .map((f) => ({ label: f.name, value: f.totalPaid, note: count(f.payments, 'payment') }))}
              empty="No payments yet."
            />
          </section>
          {(data.received.reversed.payments > 0 || data.received.pendingCheckouts > 0) && (
            <p className="text-xs text-muted-foreground">
              {data.received.reversed.payments > 0 && <>{money(data.received.reversed.amount)} in {count(data.received.reversed.payments, 'payment')} was reversed by Pesapal (refunds or chargebacks) and is not counted. </>}
              {data.received.pendingCheckouts > 0 && <>{count(data.received.pendingCheckouts, 'checkout was', 'checkouts were')} started but not finished.</>}
            </p>
          )}

          <section className="grid gap-4 lg:grid-cols-3" aria-label="Coming in and late">
            <FacilityList
              icon={CalendarClock} title={`Renewals due in the next ${data.expected.dueSoon.days} days`} total={data.expected.dueSoon.amount}
              facilities={data.expected.dueSoon.facilities} when={(f) => `due ${f.coveredUntil ? shortDate(f.coveredUntil) : '-'}`} empty="No renewals due."
            />
            <FacilityList
              icon={AlertTriangle} title="Overdue" total={data.expected.overdue.amount} tone="warn"
              facilities={data.expected.overdue.facilities} when={(f) => (f.coveredUntil ? `since ${shortDate(f.coveredUntil)}` : 'no paid period')} empty="Nobody is overdue."
            />
            <FacilityList
              icon={Hourglass} title={`Trials ending in the next ${data.expected.trialsEnding.days} days`} total={data.expected.trialsEnding.amount}
              facilities={data.expected.trialsEnding.facilities} when={(f) => `ends ${f.coveredUntil ? shortDate(f.coveredUntil) : '-'}`} empty="No trials ending soon."
            />
          </section>

          <Card className="gap-3 p-0">
            <div className="px-4 pt-4">
              <h2 className="text-lg font-semibold">Facility accounts</h2>
              <p className="text-xs text-muted-foreground">Each approved facility&apos;s plan, where it stands and what it has paid Bulamu.</p>
            </div>
            <div className="relative overflow-x-auto [contain:inline-size]">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-y bg-slate-50 text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  <tr>
                    <th className="p-3 font-medium">Facility</th>
                    <th className="p-3 font-medium">Plan</th>
                    <th className="p-3 font-medium">Standing</th>
                    <th className="p-3 text-right font-medium">Per month</th>
                    <th className="p-3 font-medium">Paid until</th>
                    <th className="p-3 font-medium">Last payment</th>
                    <th className="p-3 text-right font-medium">Paid in all</th>
                  </tr>
                </thead>
                <tbody>
                  {data.facilities.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">No approved facilities yet.</td></tr>}
                  {data.facilities.map((f) => (
                    <tr key={f.id} className="border-b last:border-0">
                      <td className="p-3"><div className="font-medium">{f.name}</div><div className="text-xs text-muted-foreground">{f.facilityCode}{!f.isActive && ' - suspended'}</div></td>
                      <td className="p-3">{f.plan === 'CUSTOM' ? 'Custom' : 'Standard'}</td>
                      <td className="p-3"><span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${STANDING_TONES[f.standing]}`}>{STANDING_LABELS[f.standing]}</span></td>
                      <td className="p-3 text-right tabular-nums">{money(f.amount)}</td>
                      <td className="p-3 whitespace-nowrap">{f.coveredUntil ? shortDate(f.coveredUntil) : '-'}</td>
                      <td className="p-3 whitespace-nowrap">{f.lastPaymentAt ? shortDate(f.lastPaymentAt) : 'Never'}</td>
                      <td className="p-3 text-right tabular-nums">{money(f.totalPaid)}<div className="text-xs text-muted-foreground">{count(f.payments, 'payment')}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="gap-3 p-0">
            <div className="px-4 pt-4">
              <h2 className="text-lg font-semibold">Payments</h2>
              <p className="text-xs text-muted-foreground">
                Newest first{data.payments.length >= data.paymentsShown ? ` - the latest ${data.paymentsShown}; the spreadsheet has every one` : ''}. Free-trial receipts are not payments and are left out.
              </p>
            </div>
            <div className="relative overflow-x-auto [contain:inline-size]">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="border-y bg-slate-50 text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  <tr>
                    <th className="p-3 font-medium">Started</th>
                    <th className="p-3 font-medium">Facility</th>
                    <th className="p-3 text-right font-medium">Amount</th>
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 font-medium">Paid for</th>
                    <th className="p-3 font-medium">How paid</th>
                    <th className="p-3 font-medium"><span className="sr-only">Receipt</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.payments.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">No payments yet.</td></tr>}
                  {data.payments.map((p) => (
                    <tr key={p.id} className={`border-b last:border-0 ${p.status === 'COMPLETED' ? '' : 'text-slate-500 dark:text-slate-400'}`}>
                      <td className="p-3 whitespace-nowrap">{shortDate(p.startedAt)}</td>
                      <td className="p-3">{p.facility.name}</td>
                      <td className="p-3 text-right tabular-nums">{money(p.amount)}</td>
                      <td className="p-3 whitespace-nowrap">{paymentStatusLabel(p.status)}{p.paidAt && p.status === 'COMPLETED' && <div className="text-xs text-muted-foreground">on {shortDate(p.paidAt)}</div>}</td>
                      <td className="p-3 whitespace-nowrap text-xs">{periodText(p.periodStart, p.periodEnd)}</td>
                      <td className="p-3 text-xs">
                        {p.method === 'CASH' ? `Cash${p.paidBy ? ` from ${p.paidBy}` : ''}` : 'Pesapal'}
                        {p.reference && <span className="block font-mono text-muted-foreground">{p.reference}</span>}
                      </td>
                      <td className="p-3 text-right">
                        {p.hasReceipt && (
                          <button
                            type="button" disabled={downloading === p.id}
                            onClick={() => download(p.id, `${API}/billing/receipts/${p.id}/pdf`, `bulamu-receipt-${p.id.slice(0, 8)}.pdf`)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-400"
                          >
                            <Download className="size-3" aria-hidden="true" />Receipt
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </main>
  );
}

function FacilityList({
  icon: Icon, title, total, facilities, when, empty, tone,
}: {
  icon: typeof Wallet; title: string; total: number; facilities: Facility[]; when: (f: Facility) => string; empty: string; tone?: 'warn';
}) {
  return (
    <Card className="gap-2 p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <Icon className={`size-4 ${tone === 'warn' ? 'text-amber-600' : 'text-emerald-700'}`} aria-hidden="true" />{title}
      </h3>
      <p className="text-xl font-semibold tabular-nums">{money(total)}</p>
      {facilities.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y text-sm">
          {facilities.map((f) => (
            <li key={f.id} className="flex items-baseline justify-between gap-3 py-1.5">
              <span className="min-w-0"><span className="block truncate">{f.name}</span><span className="text-xs text-muted-foreground">{when(f)}</span></span>
              <span className="shrink-0 tabular-nums">{money(f.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
