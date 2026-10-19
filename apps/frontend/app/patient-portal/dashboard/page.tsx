'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle, BedDouble, CalendarClock, Check, Copy, FlaskConical, Paperclip, Receipt, RefreshCw, Stethoscope, X, type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ugx } from '@/lib/finance';
import { clearPatientSession } from '@/lib/usePatientAuth';
import {
  ageOf, allergySummary, appointmentDate, billsSummary, greeting, labState, latestLabTest, nextAppointment, patientName, type PortalMe,
} from '@/lib/patient-portal';
import { PortalStaysAndReferrals } from '@/components/portal-stays-referrals';
import { PortalBills } from '@/components/patient-portal/bills';
import { PortalVisits, PortalResults } from '@/components/patient-portal/visits';
import { PortalAppointments } from '@/components/patient-portal/appointments';
import { PortalDocuments } from '@/components/patient-portal/documents';
import { EmptyState, StateBadge, TabIntro } from '@/components/patient-portal/ui';

type TabId = 'visits' | 'results' | 'bills' | 'appointments' | 'stays' | 'documents';
const TABS: Array<{ id: TabId; label: string; icon: LucideIcon }> = [
  { id: 'visits', label: 'Visits', icon: Stethoscope },
  { id: 'results', label: 'Lab results', icon: FlaskConical },
  { id: 'bills', label: 'Bills & receipts', icon: Receipt },
  { id: 'appointments', label: 'Appointments', icon: CalendarClock },
  { id: 'stays', label: 'Stays & referrals', icon: BedDouble },
  { id: 'documents', label: 'Documents', icon: Paperclip },
];
const isTab = (value: string): value is TabId => TABS.some((t) => t.id === value);

const SEX_LABELS: Record<string, string> = { MALE: 'Male', FEMALE: 'Female' };

export default function PatientPortalDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<PortalMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<TabId>('visits');
  const [copied, setCopied] = useState(false);

  const fetchMe = useCallback(async () => {
    setLoadError('');
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patient-portal/me`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('patientToken')}` },
      });
      // The sign-in has run out (or the account was closed): back to sign-in, saying why.
      if (res.status === 401) {
        clearPatientSession();
        router.replace('/patient-portal/login?session=expired');
        return;
      }
      const body = await res.json();
      if (body.success) setData(body);
      else setLoadError(body.error || "Your records couldn't be loaded just now.");
    } catch {
      setLoadError("We couldn't reach Bulamu. Please check your internet connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const fromLink = window.location.hash.slice(1);
    if (isTab(fromLink)) setTab(fromLink);
    fetchMe();
  }, [fetchMe]);

  const show = (id: TabId) => {
    setTab(id);
    window.history.replaceState(null, '', `#${id}`);
    document.getElementById('record-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Copying isn't allowed here; the ID is on screen to write down.
    }
  };

  if (loading) {
    return (
      <div aria-busy="true" aria-label="Loading your records" className="space-y-4">
        <div className="h-40 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />)}
        </div>
        <p className="text-center text-sm text-slate-500 dark:text-slate-400">Loading your records...</p>
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-900">
        <p className="font-semibold text-slate-900 dark:text-slate-100">Your records didn&apos;t load</p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{loadError}</p>
        <Button className="mt-4" onClick={() => { setLoading(true); fetchMe(); }}>
          <RefreshCw className="size-4" aria-hidden="true" /> Try again
        </Button>
      </div>
    );
  }

  const { records } = data;
  const first = records[0];
  const name = patientName(data);
  const age = ageOf(first?.dateOfBirth);
  const facts = [age !== null ? `${age} years` : null, first?.sex ? SEX_LABELS[first.sex] : null].filter(Boolean).join(' · ');
  const facilities = records.map((r) => r.clinic.name);
  const next = nextAppointment(records);
  const latest = latestLabTest(records);
  const latestState = latest ? labState(latest) : null;
  const bills = billsSummary(records);
  const allergies = allergySummary(records);
  const staysAndReferrals = records.flatMap((r) => [...(r.admissions ?? []), ...(r.referrals ?? [])]).length;
  const tabs = TABS.filter((t) => t.id !== 'stays' || staysAndReferrals > 0);
  const counts: Partial<Record<TabId, number>> = {
    visits: records.reduce((n, r) => n + r.consultations.length, 0),
    results: records.reduce((n, r) => n + r.labTests.length, 0),
    documents: records.reduce((n, r) => n + r.documents.length, 0),
  };
  const activeTab = tabs.some((t) => t.id === tab) ? tab : 'visits';

  return (
    <div className="space-y-5">
      {notice && (
        <p role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label="Dismiss" className="rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-900/40">
            <X className="size-4" aria-hidden="true" />
          </button>
        </p>
      )}

      <section className="relative overflow-hidden rounded-2xl bg-[#04211d] px-5 py-6 text-white sm:px-7 sm:py-7">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full border border-emerald-400/15" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-6 size-44 rounded-full border border-emerald-400/15" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-sm text-emerald-300">{greeting()},</p>
            <h1 className="mt-0.5 text-3xl font-bold tracking-tight sm:text-4xl">{name || 'welcome'}</h1>
            <p className="mt-2 text-sm text-slate-300">
              {facts && <>{facts} · </>}
              {facilities.length === 0 ? 'No facility has linked your records yet' : facilities.length === 1 ? `Your records from ${facilities[0]}` : `Your records from ${facilities.length} facilities`}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-300">Your Patient ID</p>
            <div className="mt-1 flex items-center gap-2">
              <span className="font-mono text-lg font-semibold tracking-wide text-emerald-300">{data.account.portableId}</span>
              <button
                type="button" onClick={() => copyId(data.account.portableId)}
                className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-slate-300 hover:bg-white/10 hover:text-white"
                aria-label="Copy your Patient ID"
              >
                {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="mt-1 max-w-64 text-xs leading-5 text-slate-400">Use it to sign in. Another facility can use it to ask to see your history - you decide.</p>
          </div>
        </div>
      </section>

      {records.length === 0 ? (
        <EmptyState icon={Stethoscope} title="No records linked yet">
          When a facility that uses Bulamu links your record to this account, your visits, results and bills appear here.
        </EmptyState>
      ) : (
        <>
          <section aria-label="At a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <GlanceTile icon={CalendarClock} label="Next appointment" onClick={() => show('appointments')}
              value={next ? `${appointmentDate(next.date)}` : 'None booked'}
              detail={next ? `${next.time}, with ${next.doctor.name}` : 'Ask for one'} />
            <GlanceTile icon={FlaskConical} label="Latest lab test" onClick={() => show('results')}
              value={latest ? latest.testName : 'None yet'}
              detail={latestState ? <StateBadge tone={latestState.tone}>{latestState.label}</StateBadge> : 'Results show here once checked'} />
            <GlanceTile icon={Receipt} label="Bills" onClick={() => show('bills')} highlight={bills.owed > 0}
              value={bills.count === 0 ? 'No bills' : bills.owed > 0 ? `${ugx(bills.owed)} to pay` : 'All paid'}
              detail={bills.count === 0 ? 'Charges show here' : bills.owed > 0 ? `On ${bills.open} bill${bills.open === 1 ? '' : 's'}, at the facility` : `${bills.count} bill${bills.count === 1 ? '' : 's'}, receipts inside`} />
            <GlanceTile icon={AlertTriangle} label="Allergies" warn={allergies.known}
              value={allergies.text}
              detail={allergies.recorded ? 'If this is wrong, tell your clinician' : 'Tell your clinician about any allergies'} />
          </section>

          <div id="record-tabs" className="scroll-mt-20">
            <div role="tablist" aria-label="Your records" className="-mx-4 flex gap-1 overflow-x-auto border-b border-slate-200 px-4 dark:border-slate-800">
              {tabs.map((t) => {
                const selected = t.id === activeTab;
                return (
                  <button
                    key={t.id} role="tab" type="button" id={`tab-${t.id}`} aria-selected={selected} aria-controls="record-panel"
                    onClick={() => show(t.id)}
                    className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium ${
                      selected
                        ? 'border-emerald-600 text-emerald-800 dark:border-emerald-400 dark:text-emerald-300'
                        : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    <t.icon className="size-4" aria-hidden="true" />
                    {t.label}
                    {counts[t.id] ? <span className="rounded-full bg-slate-100 px-1.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{counts[t.id]}</span> : null}
                    {t.id === 'bills' && bills.owed > 0 && <span className="size-2 rounded-full bg-amber-500" aria-label="Something still to pay" />}
                  </button>
                );
              })}
            </div>

            <div id="record-panel" role="tabpanel" aria-labelledby={`tab-${activeTab}`} className="pt-5">
              {activeTab === 'visits' && <PortalVisits records={records} onError={setNotice} onShowBills={() => show('bills')} />}
              {activeTab === 'results' && <PortalResults records={records} />}
              {activeTab === 'bills' && <PortalBills records={records} onError={setNotice} />}
              {activeTab === 'appointments' && <PortalAppointments records={records} onChanged={fetchMe} onError={setNotice} />}
              {activeTab === 'stays' && (
                <section>
                  <TabIntro title="Hospital stays and referrals">Times you stayed on a ward, and facilities you were sent to - with your discharge summary and referral letter to print.</TabIntro>
                  {records.map((r) => (
                    <div key={r.id} className="rounded-xl border border-slate-200 bg-white px-4 pb-4 dark:border-slate-800 dark:bg-slate-900 [&:not(:first-child)]:mt-3">
                      {records.length > 1 && <p className="pt-4 text-sm font-semibold text-slate-900 dark:text-slate-100">{r.clinic.name}</p>}
                      <PortalStaysAndReferrals referrals={r.referrals ?? []} stays={r.admissions ?? []} />
                    </div>
                  ))}
                </section>
              )}
              {activeTab === 'documents' && <PortalDocuments records={records} onChanged={fetchMe} onError={setNotice} />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function GlanceTile({ icon: Icon, label, value, detail, onClick, highlight, warn }: {
  icon: LucideIcon; label: string; value: string; detail: React.ReactNode; onClick?: () => void; highlight?: boolean; warn?: boolean;
}) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
        <Icon className={`size-4 ${warn ? 'text-red-600 dark:text-red-400' : highlight ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`} aria-hidden="true" />
        {label}
      </span>
      <span className={`mt-1.5 block font-semibold leading-snug ${warn ? 'text-red-800 dark:text-red-300' : highlight ? 'text-amber-800 dark:text-amber-200' : 'text-slate-950 dark:text-slate-50'}`}>{value}</span>
      <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{detail}</span>
    </>
  );
  const frame = `rounded-xl border bg-white p-3.5 text-left dark:bg-slate-900 ${
    warn ? 'border-red-200 dark:border-red-900' : highlight ? 'border-amber-200 dark:border-amber-900' : 'border-slate-200 dark:border-slate-800'
  }`;
  return onClick ? (
    <button type="button" onClick={onClick} className={`${frame} transition hover:border-emerald-300 hover:shadow-sm dark:hover:border-emerald-800`}>{body}</button>
  ) : (
    <div className={frame}>{body}</div>
  );
}
