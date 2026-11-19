'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { getCurrentClinicId } from '@/lib/local-first';
import { downloadWithAuth, reportReadyMessage } from '@/lib/download';
import { ACTIVITY_AGE_GROUPS, activityDefaults, activityQueryString, type ActivityChoice, type ActivityPeriod } from '@/lib/activity-report';

type Counted = { name: string; detail?: string; counts: number[]; total: number };
type Report = {
  periods: Array<{ key: string; label: string; short: string; outpatients: number; patientsSeen: number; newPatients: number; admitted: number; discharged: number; inWard: number }>;
  totals: { outpatients: number; patientsSeen: number; newPatients: number; admitted: number; discharged: number; inWard: number; labTests: number; imaging: number };
  outpatientsByAgeAndSex: Array<{ group: string; female: number; male: number; sexNotRecorded: number; total: number }>;
  labTests: Counted[];
  imaging: Counted[];
};

const API = process.env.NEXT_PUBLIC_API_URL;
const BY: Record<ActivityPeriod, string> = { day: 'Day', week: 'Week', month: 'Month' };
const TH = 'px-2 py-1.5 text-right font-medium';
const TD = 'px-2 py-1.5 text-right tabular-nums';

/**
 * The facility's activity day by day, week by week or month by month -
 * outpatients, inpatients and every lab test and imaging examination asked
 * for - for all patients or one sex or age group, with a PDF copy.
 */
export function ActivityReport() {
  const [choice, setChoice] = useState<ActivityChoice>(() => activityDefaults('day'));
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const url = (pdf: boolean) => `${API}/reports/activity/${getCurrentClinicId()}${pdf ? '/pdf' : ''}?${activityQueryString(choice)}`;

  const show = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(url(false), { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'The report could not be made - please try again.');
      setReport(data.report);
    } catch (error: any) {
      setMessage({ tone: 'error', text: navigator.onLine ? error.message : 'Reports need a connection - they are counted from the facility\'s records on the server.' });
    } finally {
      setBusy(false);
    }
  };

  const downloadPdf = async () => {
    setPdfBusy(true);
    setMessage(null);
    try {
      const { emailedTo } = await downloadWithAuth(url(true), localStorage.getItem('token'), `${choice.period === 'day' ? 'daily' : choice.period === 'week' ? 'weekly' : 'monthly'}-report-${choice.from}-to-${choice.to}.pdf`);
      setMessage({ tone: 'ok', text: reportReadyMessage('Report', emailedTo) });
    } catch (error: any) {
      setMessage({ tone: 'error', text: error.message || 'The report could not be prepared - please try again.' });
    } finally {
      setPdfBusy(false);
    }
  };

  const set = (patch: Partial<ActivityChoice>) => setChoice((c) => ({ ...c, ...patch }));

  return (
    <div className="space-y-6">
      <Card className="p-4 sm:p-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div className="col-span-2 sm:col-span-1">
            <Label htmlFor="activity-period">Show</Label>
            <Select id="activity-period" className="mt-1" value={choice.period} onChange={(e) => setChoice({ ...activityDefaults(e.target.value as ActivityPeriod), sex: choice.sex, ageGroup: choice.ageGroup })}>
              <option value="day">Day by day</option>
              <option value="week">Week by week</option>
              <option value="month">Month by month</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="activity-from">From</Label>
            <Input id="activity-from" type="date" className="mt-1" value={choice.from} max={choice.to} onChange={(e) => set({ from: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="activity-to">To</Label>
            <Input id="activity-to" type="date" className="mt-1" value={choice.to} min={choice.from} onChange={(e) => set({ to: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="activity-sex">Sex</Label>
            <Select id="activity-sex" className="mt-1" value={choice.sex} onChange={(e) => set({ sex: e.target.value as ActivityChoice['sex'] })}>
              <option value="">All</option>
              <option value="FEMALE">Female</option>
              <option value="MALE">Male</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="activity-age">Age group</Label>
            <Select id="activity-age" className="mt-1" value={choice.ageGroup} onChange={(e) => set({ ageGroup: e.target.value })}>
              <option value="">All ages</option>
              {ACTIVITY_AGE_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
            </Select>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={show} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}Show report</Button>
          <Button variant="outline" onClick={downloadPdf} disabled={pdfBusy}>
            <Download className="size-4" aria-hidden="true" />{pdfBusy ? 'Preparing...' : 'Download PDF (and email me a copy)'}
          </Button>
        </div>
        {message && (
          <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mt-4 rounded-md border px-3 py-2 text-sm ${message.tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200' : 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'}`}>
            {message.text}
          </p>
        )}
      </Card>

      {report && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([
              ['Outpatient visits', report.totals.outpatients],
              ['Different patients seen', report.totals.patientsSeen],
              ['New patients registered', report.totals.newPatients],
              ['Inpatients admitted', report.totals.admitted],
              ['Inpatients discharged', report.totals.discharged],
              ['Inpatients in the ward', report.totals.inWard],
              ['Lab tests requested', report.totals.labTests],
              ['Imaging requested', report.totals.imaging],
            ] as const).map(([label, value]) => (
              <Card key={label} className="p-4">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-slate-800 dark:text-slate-200">{value.toLocaleString('en-US')}</p>
              </Card>
            ))}
          </div>

          <Section title={`${BY[choice.period]} by ${BY[choice.period].toLowerCase()}`} note="Outpatients: visits recorded. In the ward: inpatients there at any time in the period.">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <th className="px-2 py-1.5 text-left font-medium">{BY[choice.period]}</th>
                  {['Outpatients', 'Different patients', 'New patients', 'Admitted', 'Discharged', 'In the ward'].map((h) => <th key={h} className={TH}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {report.periods.map((p) => (
                  <tr key={p.key} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="px-2 py-1.5">{p.label}</td>
                    {[p.outpatients, p.patientsSeen, p.newPatients, p.admitted, p.discharged, p.inWard].map((v, i) => <td key={i} className={TD}>{v}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Outpatient visits by age and sex" note="Age at the time of the visit.">
            <table className="w-full min-w-[26rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <th className="px-2 py-1.5 text-left font-medium">Age group</th>
                  {['Female', 'Male', 'Sex not recorded', 'Total'].map((h) => <th key={h} className={TH}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {report.outpatientsByAgeAndSex.map((r) => (
                  <tr key={r.group} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="px-2 py-1.5">{r.group}</td>
                    {[r.female, r.male, r.sexNotRecorded, r.total].map((v, i) => <td key={i} className={`${TD} ${i === 3 ? 'font-semibold' : ''}`}>{v}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <CountedTable title="Lab tests" note="Each test requested (cancelled ones left out), most requested first." first="Test" rows={report.labTests} periods={report.periods} empty="No lab tests were requested in this period." />
          <CountedTable title="Imaging" note="Each examination requested (cancelled ones left out)." first="Examination" rows={report.imaging} periods={report.periods} empty="No imaging was requested in this period." />
        </>
      )}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <Card className="p-4 sm:p-6">
      <h3 className="font-semibold text-slate-800 dark:text-slate-200">{title}</h3>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">{note}</p>
      <div className="-mx-2 overflow-x-auto">{children}</div>
    </Card>
  );
}

function CountedTable({ title, note, first, rows, periods, empty }: { title: string; note: string; first: string; rows: Counted[]; periods: Report['periods']; empty: string }) {
  return (
    <Section title={title} note={note}>
      {rows.length === 0 ? (
        <p className="px-2 text-sm text-slate-500 dark:text-slate-400">{empty}</p>
      ) : (
        <table className="w-full text-sm" style={{ minWidth: `${12 + periods.length * 3.5}rem` }}>
          <thead>
            <tr className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <th className="sticky left-0 bg-white px-2 py-1.5 text-left font-medium dark:bg-slate-900">{first}</th>
              {periods.map((p) => <th key={p.key} className={`${TH} whitespace-nowrap`} title={p.label}>{p.short}</th>)}
              <th className={TH}>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-b border-slate-100 dark:border-slate-800">
                <td className="sticky left-0 bg-white px-2 py-1.5 dark:bg-slate-900">{r.name}{r.detail && <span className="ml-1 text-xs text-slate-500">({r.detail})</span>}</td>
                {r.counts.map((v, i) => <td key={i} className={`${TD} ${v === 0 ? 'text-slate-400' : ''}`}>{v}</td>)}
                <td className={`${TD} font-semibold`}>{r.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}
