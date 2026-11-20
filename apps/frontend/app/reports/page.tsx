'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Download, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { getCurrentClinicId } from '@/lib/local-first';
import { useAuth } from '@/lib/useAuth';
import { downloadWithAuth, reportReadyMessage } from '@/lib/download';
import { ActivityReport } from '@/components/activity-report';
import { CountTable, Panel, Stat } from '@/components/report-parts';

type Tab = 'activity' | 'monthly' | 'hmis105';
const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'activity', label: 'Daily & weekly' },
  { value: 'monthly', label: 'Monthly summary' },
  { value: 'hmis105', label: 'HMIS 105 (national)' },
];
const API = process.env.NEXT_PUBLIC_API_URL;
const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, i, 1)).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' }));
const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });
// "DEPO_PROVERA" reads "Depo provera"; a short abbreviation (ANC, HIV) stays as it is.
const label = (text: string) => (/^[A-Z]{2,4}$/.test(text) ? text : text.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()));

type Monthly = {
  totalPatients: number; totalAppointments: number; totalConsultations: number; revenue: number;
  topDiagnoses: Array<{ diagnosis: string; icd10Code: string | null; _count: { diagnosis: number } }>;
  byUnit?: Array<{ name: string; appointments: number; visits: number }>;
};

export default function ReportsPage() {
  const { hasRole } = useAuth();
  const [tab, setTab] = useState<Tab>('activity');
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [monthly, setMonthly] = useState<Monthly | null>(null);
  const [hmis, setHmis] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pushing, setPushing] = useState(false);
  const thisYear = new Date().getFullYear();

  // The month's figures load as soon as the tab or the month is chosen.
  const load = useCallback(async () => {
    if (tab === 'activity') return;
    setLoading(true);
    setMessage(null);
    const path = tab === 'monthly' ? 'monthly' : 'hmis-105';
    try {
      const res = await fetch(`${API}/reports/${path}/${getCurrentClinicId()}?month=${month}&year=${year}`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'The report could not be made - please try again.');
      if (tab === 'monthly') setMonthly(data.report);
      else setHmis(data);
    } catch (error: any) {
      setMessage({ tone: 'error', text: navigator.onLine ? error.message : 'Reports need a connection - they are counted from the facility\'s records on the server.' });
    } finally {
      setLoading(false);
    }
  }, [tab, month, year]);

  useEffect(() => {
    void load();
  }, [load]);

  const downloadMonthlyPdf = async () => {
    setPdfBusy(true);
    setMessage(null);
    try {
      const { emailedTo } = await downloadWithAuth(`${API}/reports/monthly/${getCurrentClinicId()}/pdf?month=${month}&year=${year}`, localStorage.getItem('token'), `monthly-report-${year}-${String(month).padStart(2, '0')}.pdf`);
      setMessage({ tone: 'ok', text: reportReadyMessage('Monthly report', emailedTo) });
    } catch (error: any) {
      setMessage({ tone: 'error', text: error.message || 'The report could not be prepared - please try again.' });
    } finally {
      setPdfBusy(false);
    }
  };

  const pushToDhis2 = async () => {
    setPushing(true);
    setMessage(null);
    try {
      const res = await fetch(`${API}/reports/hmis-105/${getCurrentClinicId()}/push-dhis2?month=${month}&year=${year}`, { method: 'POST', headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!data.success) throw new Error(`DHIS2 did not accept it: ${data.error || 'unknown error'}`);
      setMessage({ tone: 'ok', text: `Sent to DHIS2.${data.unmappedFigures?.length ? ` ${data.unmappedFigures.length} figures have no DHIS2 data element set up yet.` : ''}` });
    } catch (error: any) {
      setMessage({ tone: 'error', text: navigator.onLine ? error.message : 'Sending to DHIS2 needs a connection.' });
    } finally {
      setPushing(false);
    }
  };

  const downloadFhirExport = async () => {
    try {
      const res = await fetch(`${API}/reports/fhir/patients/${getCurrentClinicId()}`, { headers: authHeaders() });
      const blob = new Blob([JSON.stringify(await res.json(), null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'fhir-patients-bundle.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setMessage({ tone: 'error', text: 'The FHIR export could not be downloaded - please try again.' });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8 dark:bg-slate-950">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-200">Reports</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Your facility&apos;s figures: day by day and week by week, each month, and the national HMIS 105.</p>

        <div role="tablist" aria-label="Reports" className="mb-6 mt-5 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => { setTab(t.value); setMessage(null); }}
              className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${tab === t.value ? 'border-emerald-700 text-emerald-800 dark:border-emerald-400 dark:text-emerald-300' : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'activity' && <ActivityReport />}

        {tab !== 'activity' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div>
                <Label htmlFor="report-month">Month</Label>
                <Select id="report-month" className="mt-1 min-w-[10rem]" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                  {MONTHS.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="report-year">Year</Label>
                <Select id="report-year" className="mt-1" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                  {Array.from({ length: 4 }, (_, i) => thisYear - i).map((y) => <option key={y} value={y}>{y}</option>)}
                </Select>
              </div>
              <Button variant="outline" onClick={() => void load()} disabled={loading}>
                {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-4" aria-hidden="true" />}Refresh
              </Button>
              {tab === 'monthly' && hasRole('ADMIN', 'DOCTOR') && (
                <Button onClick={downloadMonthlyPdf} disabled={pdfBusy}>
                  <Download className="size-4" aria-hidden="true" />{pdfBusy ? 'Preparing...' : 'Download PDF (and email me a copy)'}
                </Button>
              )}
            </div>

            {message && (
              <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-md border px-3 py-2 text-sm ${message.tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200' : 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'}`}>
                {message.text}
              </p>
            )}

            {loading && !(tab === 'monthly' ? monthly : hmis) && <p className="text-sm text-slate-500"><Loader2 className="mr-2 inline size-4 animate-spin" aria-hidden="true" />Counting...</p>}

            {tab === 'monthly' && monthly && (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Stat label="Patients seen (visits)" value={monthly.totalConsultations} />
                  <Stat label="New patients registered" value={monthly.totalPatients} />
                  <Stat label="Appointments booked" value={monthly.totalAppointments} />
                  <Stat label="Money received (UGX)" value={Math.round(monthly.revenue)} tone="good" />
                </div>
                <Panel title="Most common diagnoses" note="Primary diagnoses of the month's visits, counted by ICD-10 code.">
                  <CountTable
                    head={['Diagnosis', 'ICD-10', 'Visits']}
                    rows={monthly.topDiagnoses.map((d) => [d.diagnosis, d.icd10Code ?? '-', d._count.diagnosis])}
                    empty="No diagnoses recorded this month."
                  />
                </Panel>
                {!!monthly.byUnit?.length && (
                  <Panel title="Visits by unit" note="Booked: appointments in the unit this month. Seen: visits recorded there.">
                    <div data-testid="visits-by-unit"><CountTable head={['Unit', 'Booked', 'Seen']} rows={monthly.byUnit.map((u) => [u.name, u.appointments, u.visits])} /></div>
                  </Panel>
                )}
              </>
            )}

            {tab === 'hmis105' && hmis && (
              <>
                <Panel
                  title={hmis.reportTitle}
                  note={`${hmis.facilityName} - ${MONTHS[month - 1]} ${year}. The Ministry of Health outpatient monthly report.`}
                  action={hasRole('ADMIN', 'SUPER_ADMIN') ? (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={pushToDhis2} disabled={pushing}><RefreshCw className="size-4" aria-hidden="true" />{pushing ? 'Sending...' : 'Send to DHIS2'}</Button>
                      <Button size="sm" variant="outline" onClick={downloadFhirExport}><Download className="size-4" aria-hidden="true" />FHIR export</Button>
                    </div>
                  ) : undefined}
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Stat label="Outpatient visits" value={hmis.section1_attendance.totalOutpatients} />
                    <Stat label="New attendances" value={hmis.section1_attendance.newAttenders} />
                    <Stat label="Re-attendances" value={hmis.section1_attendance.reAttenders} />
                  </div>
                </Panel>
                {hmis.section1_attendance.byAgeCohortAndGender && (
                  <Panel title="1. Outpatient attendance by age and sex" note="Patients with a date of birth recorded.">
                    <CountTable
                      head={['Age group', 'Female', 'Male', 'Not recorded', 'Total']}
                      rows={Object.entries(hmis.section1_attendance.byAgeCohortAndGender as Record<string, { male: number; female: number; other: number }>).map(([cohort, c]) => [cohort, c.female, c.male, c.other, c.female + c.male + c.other])}
                      minWidth="24rem"
                    />
                  </Panel>
                )}
                <Panel title="2. Epidemic-prone diseases" note="Cases among the month's visits.">
                  <CountTable head={['Condition', 'Cases']} rows={hmis.section2_epidemicSurveillance.map((r: { condition: string; cases: number }) => [r.condition, r.cases])} />
                </Panel>
                <Panel title="3. Essential medicines">
                  <div className="grid grid-cols-2 gap-3">
                    <Stat label="Medicines tracked" value={hmis.section3_essentialMedicines.totalTracked} />
                    <Stat label="Low or out of stock" value={hmis.section3_essentialMedicines.stockOutAlerts} tone={hmis.section3_essentialMedicines.stockOutAlerts ? 'warn' : undefined} />
                  </div>
                  {hmis.section3_essentialMedicines.lowStockList?.length > 0 && (
                    <ul className="mt-3 space-y-1">
                      {hmis.section3_essentialMedicines.lowStockList.map((m: { name: string; currentQuantity: number; reorderLevel: number }) => (
                        <li key={m.name} className="flex items-start gap-1.5 text-sm text-rose-800 dark:text-rose-300">
                          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{m.name}: {m.currentQuantity} left (reorder at {m.reorderLevel})
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
                <div className="grid gap-5 md:grid-cols-2">
                  <Panel title="4. Family planning" note={`${hmis.section4_familyPlanning.totalRecorded} records this month.`}>
                    <CountTable head={['Method', 'Clients']} rows={Object.entries(hmis.section4_familyPlanning.byMethod as Record<string, number>).map(([m, n]) => [label(m), n])} empty="None recorded this month." />
                  </Panel>
                  <Panel title="5. Maternal health">
                    <div className="grid grid-cols-2 gap-3">
                      <Stat label="Pregnant clients" value={hmis.section5_maternalHealth.pregnantClients} />
                      <Stat label="Postpartum clients" value={hmis.section5_maternalHealth.postpartumClients} />
                    </div>
                  </Panel>
                </div>
                <div className="grid gap-5 md:grid-cols-2">
                  <Panel title="6. Other services">
                    <CountTable head={['Service', 'Visits']} rows={Object.entries(hmis.section6_services.byTag as Record<string, number>).map(([t, n]) => [label(t), n])} empty="None recorded this month." />
                  </Panel>
                  <Panel title="7. Referrals out" note={`${hmis.section7_referrals.totalReferred} referred this month.`}>
                    <CountTable head={['To', 'Reason', 'Status']} rows={(hmis.section7_referrals.referrals ?? []).map((r: { toFacility: string; reason: string; status: string }) => [r.toFacility, r.reason, label(r.status)])} empty="No referrals out this month." />
                  </Panel>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
