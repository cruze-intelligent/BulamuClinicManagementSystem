'use client';

import { useState } from 'react';
import { FileSpreadsheet, FileText, Loader2, XCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { downloadWithAuth } from '@/lib/download';
import { kampalaToday } from '@/lib/finance';
import {
  REPORT_PERIODS, REPORT_SECTIONS, categoriesFor, categoryHeading, periodDates, periodProblem, reportFileName, reportQuery,
  type ReportPeriod, type ReportSection,
} from '@/lib/finance-report';

/**
 * Downloads the facility's financial report for its books or its accountant:
 * everything, or one part narrowed to one category, over a chosen period - as
 * a PDF on the facility's letterhead or a spreadsheet.
 */
export function FinanceReportExport({ clinicId }: { clinicId: string }) {
  const today = kampalaToday();
  const [period, setPeriod] = useState<ReportPeriod>('this-month');
  const [custom, setCustom] = useState(() => periodDates('this-month', today));
  const [section, setSection] = useState<ReportSection>('all');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState<'pdf' | 'csv' | null>(null);
  const [error, setError] = useState('');

  const { from, to } = period === 'custom' ? custom : periodDates(period, today);
  const categories = categoriesFor(section);
  const problem = periodProblem(from, to);

  const download = async (format: 'pdf' | 'csv') => {
    if (problem) return setError(problem);
    const choice = { from, to, section, category, format };
    setBusy(format);
    setError('');
    try {
      await downloadWithAuth(`${process.env.NEXT_PUBLIC_API_URL}/finances/${clinicId}/report?${reportQuery(choice)}`, localStorage.getItem('token'), reportFileName(choice));
    } catch (e: any) {
      setError(e.message || 'The report could not be downloaded - please try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-label="Reports">
      <Card className="p-5" data-testid="finance-report-export">
        <h2 className="text-lg font-semibold">Download a financial report</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
          For your books or your accountant: everything, or one part - and within it one payment method, kind of charge or kind of spending.
          The PDF carries your facility&apos;s letterhead and logo with totals per category; the spreadsheet has every line. Voided receipts and
          expenses are listed and marked, never counted.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="report-period" className="text-xs">Period</Label>
            <Select id="report-period" value={period} onChange={(e) => setPeriod(e.target.value as ReportPeriod)}>
              {REPORT_PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
            {period === 'custom' ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input aria-label="From" type="date" value={custom.from} max={today} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className="w-40" />
                <span className="text-sm text-slate-500">to</span>
                <Input aria-label="To" type="date" value={custom.to} max={today} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className="w-40" />
              </div>
            ) : (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{readable(from)} to {readable(to)}</p>
            )}
          </div>

          <div>
            <Label htmlFor="report-section" className="text-xs">Include</Label>
            <Select id="report-section" value={section} onChange={(e) => { setSection(e.target.value as ReportSection); setCategory(''); }}>
              {REPORT_SECTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
            {categories.length > 0 && (
              <div className="mt-2">
                <Label htmlFor="report-category" className="text-xs">{categoryHeading(section)}</Label>
                <Select id="report-category" value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">All</option>
                  {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </Select>
              </div>
            )}
            {(section === 'all' || section === 'outstanding') && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">What patients still owe is as of today, whatever the period.</p>
            )}
          </div>
        </div>

        {(error || problem) && (
          <p role="alert" className="mt-4 flex items-start gap-1.5 text-sm text-red-700 dark:text-red-400">
            <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error || problem}
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={() => download('pdf')} disabled={!!busy || !!problem}>
            {busy === 'pdf' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <FileText className="size-4" aria-hidden="true" />}
            Download PDF
          </Button>
          <Button variant="outline" onClick={() => download('csv')} disabled={!!busy || !!problem}>
            {busy === 'csv' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <FileSpreadsheet className="size-4" aria-hidden="true" />}
            Download spreadsheet (CSV)
          </Button>
        </div>
      </Card>
    </section>
  );
}

const readable = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
