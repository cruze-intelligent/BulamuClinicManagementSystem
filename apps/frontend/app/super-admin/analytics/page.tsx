'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Download, RefreshCw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useAuth } from '@/lib/useAuth';
import { downloadWithAuth } from '@/lib/download';
import { facilityTypeLabel } from '@/lib/facility-types';
import { roleLabel } from '@/lib/role-labels';
import { BarList, ShareRow, StatTile, TimeSeriesChart } from '@/components/analytics-charts';
import { FacilityDetailsModal } from '@/components/facility-details-modal';
import {
  ENGAGEMENT_LABELS, Point, compactNumber, engagementRank, formatBytes, formatNumber, formatPercent, formatUptime, humanize, timeAgo,
} from '@/lib/analytics-format';

const API = process.env.NEXT_PUBLIC_API_URL;

type Facility = {
  id: string; facilityCode: string; name: string; facilityType: string; district: string | null;
  engagement: string; lastActivityAt: string | null; registeredAt: string; suspended: boolean;
  subscription: { status: string; plan: string } | null;
  staffAccounts: number; activeStaffInPeriod: number; patients: number; newPatientsInPeriod: number; consultationsInPeriod: number;
};
type Analytics = {
  generatedAt: string; trackingStartedAt: string | null; period: { days: number; from: string; to: string };
  headline: {
    facilities: { approved: number; active: number; pending: number; suspended: number };
    staff: { total: number; activeAccounts: number; activeToday: number; activeThisWeek: number; activeThisMonth: number; stickiness: number | null };
    patients: { total: number; new: number; newChange: number | null };
    consultations: { count: number; change: number | null };
    revenue: { currency: string; inPeriod: number; payments: number; change: number | null; monthlyRecurring: number };
    subscriptions: { active: number; trialing: number; pastDue: number; cancelled: number; trialsEndingSoon: number; customPlans: number };
  };
  series: Record<'activeStaff' | 'newPatients' | 'consultations' | 'appointments' | 'newFacilities' | 'signIns' | 'failedSignIns', Point[]>;
  staffByRole: Array<{ role: string; accounts: number; activeInPeriod: number }>;
  distributions: {
    facilityTypes: Array<{ key: string; count: number }>; districts: Array<{ key: string; count: number }>; districtsOther: number;
    subscriptionStatus: Array<{ key: string; count: number }>;
  };
  adoption: {
    facilitiesRecording: { count: number; of: number };
    prescriptions: { written: number; dispensed: number; dispensedShare: number | null };
    allergiesRecorded: { patients: number; of: number; share: number | null };
    codedDiagnoses: { consultations: number; of: number; share: number | null };
    portal: { accounts: number; activated: number; activatedShare: number | null; createdInPeriod: number };
    documents: { byStaff: number; byPatients: number };
    appointments: Array<{ key: string; count: number }>;
    labTests: number; referrals: number;
  };
  security: {
    signIns: number; wrongPassword: number; blocked: number; accountsNeverSignedIn: number; deactivatedAccounts: number;
    syncConflicts: number; auditEvents: number; notifications: number; pendingApprovals: number;
  };
  facilities: Facility[];
};
type StaffRow = {
  id: string; name: string; email: string; role: string; isActive: boolean; lastLoginAt: string | null; lastSeenAt: string | null;
  activeDaysLast30: number; clinic: { id: string; name: string; facilityCode: string };
};
type Runtime = {
  startedAt: string; uptimeSeconds: number;
  sinceStart: Summary; lastHour: Summary & { perMinute: Array<{ minute: string; requests: number; serverErrors: number }> };
  busiestRoutes: RouteRow[]; slowestRoutes: RouteRow[]; erroringRoutes: RouteRow[];
};
type Summary = { requests: number; serverErrors: number; clientErrors: number; serverErrorRate: number; p50: { ms: number; overflow: boolean } | null; p95: { ms: number; overflow: boolean } | null };
type RouteRow = { route: string; requests: number; errors: number; avgMs: number; maxMs: number };
type SystemReport = {
  server: { nodeVersion: string; environment: string; release: string | null; memoryRssMb: number; heapUsedMb: number };
  database: {
    pingMs: number; sizeBytes: number; migrationsApplied: number; latestMigration: string | null;
    largestTables: Array<{ name: string; bytes: number; rows: number }>;
    totals: { facilities: number; users: number; patients: number; consultations: number; auditEntries: number };
  };
  storage: { documents: number; documentBytes: number; persistent: boolean };
  configuration: Array<{ key: string; label: string; ok: boolean; hint: string }>;
  runtime: Runtime;
};

const TABS = ['Overview', 'Facilities', 'Users', 'System'] as const;
type Tab = (typeof TABS)[number];

const latency = (l: { ms: number; overflow: boolean } | null) => (l ? `${l.overflow ? '>' : '≤'} ${l.ms} ms` : '-');

function StatusBadge({ ok, okLabel = 'OK', badLabel = 'Needs attention' }: { ok: boolean; okLabel?: string; badLabel?: string }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />{okLabel}</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />{badLabel}</span>
  );
}

function EngagementBadge({ status }: { status: string }) {
  const good = status === 'ACTIVE' || status === 'NEW';
  const bad = status === 'DORMANT' || status === 'NEVER_USED';
  const Icon = good ? CheckCircle2 : bad ? XCircle : AlertTriangle;
  const tone = good ? 'text-emerald-700 dark:text-emerald-400' : bad ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400';
  return <span className={`inline-flex items-center gap-1 text-xs font-medium ${tone}`}><Icon className="h-3.5 w-3.5" aria-hidden />{ENGAGEMENT_LABELS[status] ?? status}</span>;
}

export default function SuperAdminAnalyticsPage() {
  const { user, hasRole } = useAuth();
  const router = useRouter();
  const signedIn = !!user;
  const isOperator = hasRole('SUPER_ADMIN');

  const [tab, setTab] = useState<Tab>('Overview');
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [system, setSystem] = useState<SystemReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [exporting, setExporting] = useState('');

  // Facilities table controls
  const [facilityFilter, setFacilityFilter] = useState('ALL');
  const [facilitySearch, setFacilitySearch] = useState('');
  const [facilitySort, setFacilitySort] = useState<'engagement' | 'name' | 'patients' | 'consultations'>('engagement');

  // Users directory
  const [users, setUsers] = useState<{ rows: StaffRow[]; total: number }>({ rows: [], total: 0 });
  const [userSearch, setUserSearch] = useState('');
  const [userRole, setUserRole] = useState('');
  const [userStatus, setUserStatus] = useState('');
  const [userPage, setUserPage] = useState(1);
  const pageSize = 25;

  useEffect(() => {
    if (!signedIn) return;
    if (!isOperator) router.replace('/dashboard');
  }, [signedIn, isOperator, router]);

  // One fetch per period change or explicit refresh - no polling.
  useEffect(() => {
    if (!isOperator) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const token = localStorage.getItem('token');
        const headers = { Authorization: `Bearer ${token}` };
        const [a, s] = await Promise.all([
          fetch(`${API}/super-admin/analytics?days=${days}`, { headers }).then((r) => r.json()),
          fetch(`${API}/super-admin/system`, { headers }).then((r) => r.json()),
        ]);
        if (cancelled) return;
        if (!a.success) throw new Error(a.error || 'Could not load analytics');
        setData(a.analytics);
        if (s.success) setSystem(s.system);
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Could not load analytics');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOperator, days, reloadKey]);

  useEffect(() => {
    if (!isOperator || tab !== 'Users') return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const token = localStorage.getItem('token');
        const qs = new URLSearchParams({ page: String(userPage), pageSize: String(pageSize) });
        if (userSearch.trim()) qs.set('search', userSearch.trim());
        if (userRole) qs.set('role', userRole);
        if (userStatus) qs.set('status', userStatus);
        const res = await fetch(`${API}/super-admin/users?${qs}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
        if (!cancelled && res.success) setUsers({ rows: res.users, total: res.total });
      } catch { /* keep the previous rows */ }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [isOperator, tab, userSearch, userRole, userStatus, userPage, reloadKey]);

  const facilities = useMemo(() => {
    if (!data) return [];
    const q = facilitySearch.trim().toLowerCase();
    return data.facilities
      .filter((f) => (facilityFilter === 'ALL' || f.engagement === facilityFilter) && (!q || `${f.name} ${f.facilityCode} ${f.district ?? ''}`.toLowerCase().includes(q)))
      .sort((a, b) =>
        facilitySort === 'name' ? a.name.localeCompare(b.name)
        : facilitySort === 'patients' ? b.patients - a.patients
        : facilitySort === 'consultations' ? b.consultationsInPeriod - a.consultationsInPeriod
        : engagementRank(a.engagement) - engagementRank(b.engagement) || a.name.localeCompare(b.name));
  }, [data, facilityFilter, facilitySearch, facilitySort]);

  const exportCsv = useCallback(async (dataset: 'facilities' | 'daily' | 'users') => {
    setExporting(dataset);
    try {
      const qs = new URLSearchParams({ dataset, days: String(days) });
      if (dataset === 'users') {
        if (userSearch.trim()) qs.set('search', userSearch.trim());
        if (userRole) qs.set('role', userRole);
        if (userStatus) qs.set('status', userStatus);
      }
      await downloadWithAuth(`${API}/super-admin/analytics/export?${qs}`, localStorage.getItem('token'), `bulamu-${dataset}-${days}d.csv`);
    } catch (e: any) {
      alert(e.message || 'Export failed');
    } finally {
      setExporting('');
    }
  }, [days, userSearch, userRole, userStatus]);

  if (!isOperator) return null;

  const h = data?.headline;
  const rt = system?.runtime;

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Platform analytics</h1>
          <p className="text-sm text-muted-foreground">
            How Bulamu is being used and how the system is doing. Counts only - no patient or clinical details. Days are East Africa Time.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted-foreground" htmlFor="period">Period</label>
          <Select id="period" className="w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </Select>
          <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} aria-hidden /> Refresh
          </Button>
        </div>
      </header>

      <div role="tablist" aria-label="Analytics sections" className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm -mb-px border-b-2 ${tab === t ? 'border-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {error && <Card className="p-4 text-sm text-red-700 dark:text-red-400" role="alert">{error}</Card>}
      {!data && loading && <p className="text-sm text-muted-foreground">Loading analytics...</p>}

      {data && h && (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'} aria-busy={loading}>
          {data.trackingStartedAt && (
            <p className="text-xs text-muted-foreground mb-4">
              Staff activity has been recorded since {new Date(data.trackingStartedAt).toLocaleDateString()}; earlier days show no activity because it was not measured yet.
            </p>
          )}

          {tab === 'Overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatTile label="Facilities" value={formatNumber(h.facilities.approved)} hint={`${h.facilities.pending} awaiting approval${h.facilities.suspended ? `, ${h.facilities.suspended} suspended` : ''}`} />
                <StatTile label="Staff active this week" value={formatNumber(h.staff.activeThisWeek)} hint={`of ${formatNumber(h.staff.activeAccounts)} accounts`} />
                <StatTile label="Patients" value={formatNumber(h.patients.total)} change={h.patients.newChange} hint={`+${formatNumber(h.patients.new)} new`} />
                <StatTile label="Consultations" value={formatNumber(h.consultations.count)} change={h.consultations.change} hint={`last ${data.period.days} days`} />
                <StatTile label={`Revenue (${h.revenue.currency})`} value={compactNumber(h.revenue.inPeriod)} change={h.revenue.change} hint={`${h.revenue.payments} payments`} />
                <StatTile label="Monthly recurring" value={compactNumber(h.revenue.monthlyRecurring)} hint={`${h.subscriptions.active} active plans`} />
                <StatTile label="Active today / month" value={`${h.staff.activeToday} / ${h.staff.activeThisMonth}`} hint={h.staff.stickiness == null ? undefined : `${formatPercent(h.staff.stickiness)} daily habit`} />
                <StatTile label="Trials ending soon" value={formatNumber(h.subscriptions.trialsEndingSoon)} hint={`${h.subscriptions.trialing} on trial, ${h.subscriptions.pastDue} past due`} goodWhenUp={false} />
              </div>

              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => exportCsv('daily')} disabled={exporting === 'daily'}>
                  <Download className="h-4 w-4 mr-1" aria-hidden />{exporting === 'daily' ? 'Preparing...' : 'Export daily activity (CSV)'}
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                <TimeSeriesChart title="Active staff per day" points={data.series.activeStaff} />
                <TimeSeriesChart title="Consultations per day" points={data.series.consultations} />
                <TimeSeriesChart title="New patients per day" points={data.series.newPatients} />
                <TimeSeriesChart title="Appointments booked per day" points={data.series.appointments} />
                <TimeSeriesChart title="Successful sign-ins per day" points={data.series.signIns} />
                <TimeSeriesChart title="Failed or blocked sign-ins per day" points={data.series.failedSignIns} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                <BarList title="Facilities by type" rows={data.distributions.facilityTypes.map((d) => ({ label: facilityTypeLabel(d.key), value: d.count }))} />
                <BarList
                  title="Facilities by district"
                  rows={[...data.distributions.districts.map((d) => ({ label: d.key, value: d.count })), ...(data.distributions.districtsOther ? [{ label: 'Other districts', value: data.distributions.districtsOther }] : [])]}
                  empty="No districts recorded yet."
                />
                <BarList title="Staff by role (accounts)" rows={data.staffByRole.map((r) => ({ label: roleLabel(r.role), value: r.accounts, note: `${r.activeInPeriod} active` }))} />
                <BarList title="Subscriptions" rows={data.distributions.subscriptionStatus.map((d) => ({ label: humanize(d.key), value: d.count }))} />
              </div>

              <Card className="p-4 gap-4">
                <h3 className="text-sm font-medium">Feature adoption (last {data.period.days} days)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                  <ShareRow label="Facilities recording patients" count={data.adoption.facilitiesRecording.count} of={data.adoption.facilitiesRecording.of} />
                  <ShareRow label="Consultations with a coded (ICD-10) diagnosis" count={data.adoption.codedDiagnoses.consultations} of={data.adoption.codedDiagnoses.of} />
                  <ShareRow label="Patients with an allergy record" count={data.adoption.allergiesRecorded.patients} of={data.adoption.allergiesRecorded.of} />
                  <ShareRow label="Prescriptions dispensed" count={data.adoption.prescriptions.dispensed} of={data.adoption.prescriptions.written} detail="of prescriptions written in the period" />
                  <ShareRow label="Patient portal accounts activated" count={data.adoption.portal.activated} of={data.adoption.portal.accounts} detail={`${data.adoption.portal.createdInPeriod} created in the period`} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Lab tests ordered: {formatNumber(data.adoption.labTests)} · Referrals: {formatNumber(data.adoption.referrals)} · Documents uploaded: {formatNumber(data.adoption.documents.byStaff)} by staff, {formatNumber(data.adoption.documents.byPatients)} by patients
                </p>
              </Card>

              <Card className="p-4 gap-3">
                <h3 className="text-sm font-medium">Sign-in health (last {data.period.days} days)</h3>
                <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  {([
                    ['Successful sign-ins', data.security.signIns],
                    ['Wrong password', data.security.wrongPassword],
                    ['Blocked (pending / suspended)', data.security.blocked],
                    ['Never signed in (registered over a week ago)', data.security.accountsNeverSignedIn],
                    ['Deactivated accounts', data.security.deactivatedAccounts],
                    ['Sync conflicts', data.security.syncConflicts],
                    ['Audit events', data.security.auditEvents],
                    ['Facilities awaiting approval', data.security.pendingApprovals],
                  ] as Array<[string, number]>).map(([k, v]) => (
                    <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-semibold tabular-nums">{formatNumber(v)}</dd></div>
                  ))}
                </dl>
              </Card>
            </div>
          )}

          {tab === 'Facilities' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <Input className="w-56" placeholder="Search facility or district" aria-label="Search facilities" value={facilitySearch} onChange={(e) => setFacilitySearch(e.target.value)} />
                <Select className="w-auto" aria-label="Filter by engagement" value={facilityFilter} onChange={(e) => setFacilityFilter(e.target.value)}>
                  <option value="ALL">All engagement</option>
                  {Object.entries(ENGAGEMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
                <Select className="w-auto" aria-label="Sort facilities" value={facilitySort} onChange={(e) => setFacilitySort(e.target.value as typeof facilitySort)}>
                  <option value="engagement">Sort: engagement</option>
                  <option value="name">Sort: name</option>
                  <option value="patients">Sort: patients</option>
                  <option value="consultations">Sort: consultations</option>
                </Select>
                <div className="ml-auto">
                  <Button variant="outline" size="sm" onClick={() => exportCsv('facilities')} disabled={exporting === 'facilities'}>
                    <Download className="h-4 w-4 mr-1" aria-hidden />{exporting === 'facilities' ? 'Preparing...' : 'Export (CSV)'}
                  </Button>
                </div>
              </div>
              <Card className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground border-b">
                    <tr>
                      <th className="text-left font-normal p-3">Facility</th>
                      <th className="text-left font-normal p-3">Engagement</th>
                      <th className="text-left font-normal p-3">Last activity</th>
                      <th className="text-right font-normal p-3">Staff active / total</th>
                      <th className="text-right font-normal p-3">Patients</th>
                      <th className="text-right font-normal p-3">Consultations</th>
                      <th className="text-left font-normal p-3">Plan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {facilities.map((f) => (
                      <tr key={f.id} className="border-b last:border-0 hover:bg-muted/50 cursor-pointer" onClick={() => setDetailsId(f.id)} data-testid="facility-row">
                        <td className="p-3">
                          <button className="text-left font-medium underline-offset-2 hover:underline" onClick={(e) => { e.stopPropagation(); setDetailsId(f.id); }}>{f.name}</button>
                          <div className="text-xs text-muted-foreground">{facilityTypeLabel(f.facilityType)} · {f.district ?? 'No district'} · {f.facilityCode}</div>
                        </td>
                        <td className="p-3"><EngagementBadge status={f.engagement} />{f.suspended && <div className="text-xs text-muted-foreground">Suspended</div>}</td>
                        <td className="p-3 text-muted-foreground">{timeAgo(f.lastActivityAt)}</td>
                        <td className="p-3 text-right tabular-nums">{f.activeStaffInPeriod} / {f.staffAccounts}</td>
                        <td className="p-3 text-right tabular-nums">{formatNumber(f.patients)}{f.newPatientsInPeriod ? <span className="text-xs text-muted-foreground"> (+{f.newPatientsInPeriod})</span> : null}</td>
                        <td className="p-3 text-right tabular-nums">{formatNumber(f.consultationsInPeriod)}</td>
                        <td className="p-3 text-muted-foreground">{f.subscription ? `${humanize(f.subscription.status)}` : '-'}</td>
                      </tr>
                    ))}
                    {facilities.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No facilities match.</td></tr>}
                  </tbody>
                </table>
              </Card>
              <p className="text-xs text-muted-foreground">Engagement: Active = something recorded in the last 7 days; Quiet = 8-30 days; Dormant = over 30 days; Never used = registered over 14 days ago with nothing recorded. Click a row for the facility's details.</p>
            </div>
          )}

          {tab === 'Users' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <Input className="w-56" placeholder="Search name, email or facility" aria-label="Search staff" value={userSearch} onChange={(e) => { setUserSearch(e.target.value); setUserPage(1); }} />
                <Select className="w-auto" aria-label="Filter by role" value={userRole} onChange={(e) => { setUserRole(e.target.value); setUserPage(1); }}>
                  <option value="">All roles</option>
                  {['ADMIN', 'DOCTOR', 'NURSE', 'PHARMACIST', 'STAFF'].map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                </Select>
                <Select className="w-auto" aria-label="Filter by status" value={userStatus} onChange={(e) => { setUserStatus(e.target.value); setUserPage(1); }}>
                  <option value="">Any status</option>
                  <option value="active">Active accounts</option>
                  <option value="inactive">Deactivated</option>
                </Select>
                <div className="ml-auto">
                  <Button variant="outline" size="sm" onClick={() => exportCsv('users')} disabled={exporting === 'users'}>
                    <Download className="h-4 w-4 mr-1" aria-hidden />{exporting === 'users' ? 'Preparing...' : 'Export (CSV)'}
                  </Button>
                </div>
              </div>
              <Card className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground border-b">
                    <tr>
                      <th className="text-left font-normal p-3">Staff member</th>
                      <th className="text-left font-normal p-3">Facility</th>
                      <th className="text-left font-normal p-3">Last seen</th>
                      <th className="text-left font-normal p-3">Last sign-in</th>
                      <th className="text-right font-normal p-3">Active days (30)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.rows.map((u) => (
                      <tr key={u.id} className="border-b last:border-0" data-testid="user-row">
                        <td className="p-3">
                          <div className="font-medium">{u.name}{!u.isActive && <span className="ml-2 text-xs text-muted-foreground">(deactivated)</span>}</div>
                          <div className="text-xs text-muted-foreground">{roleLabel(u.role)} · {u.email}</div>
                        </td>
                        <td className="p-3">{u.clinic.name}</td>
                        <td className="p-3 text-muted-foreground">{timeAgo(u.lastSeenAt)}</td>
                        <td className="p-3 text-muted-foreground">{timeAgo(u.lastLoginAt)}</td>
                        <td className="p-3 text-right tabular-nums">{u.activeDaysLast30}</td>
                      </tr>
                    ))}
                    {users.rows.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No staff match.</td></tr>}
                  </tbody>
                </table>
              </Card>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{formatNumber(users.total)} staff</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={userPage <= 1} onClick={() => setUserPage((p) => p - 1)}>Previous</Button>
                  <span>Page {userPage} of {Math.max(1, Math.ceil(users.total / pageSize))}</span>
                  <Button variant="outline" size="sm" disabled={userPage >= Math.ceil(users.total / pageSize)} onClick={() => setUserPage((p) => p + 1)}>Next</Button>
                </div>
              </div>
            </div>
          )}

          {tab === 'System' && (
            <div className="space-y-6">
              {!system ? (
                <p className="text-sm text-muted-foreground">System details are unavailable right now.</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <StatTile label="Database response" value={`${system.database.pingMs} ms`} hint={`${formatBytes(system.database.sizeBytes)} stored`} />
                    <StatTile label="Server uptime" value={formatUptime(system.runtime.uptimeSeconds)} hint={`Node ${system.server.nodeVersion}${system.server.release ? ` · ${system.server.release}` : ''}`} />
                    <StatTile label="Memory in use" value={`${system.server.memoryRssMb} MB`} hint={`${system.server.heapUsedMb} MB heap`} />
                    <StatTile label="Documents stored" value={formatNumber(system.storage.documents)} hint={formatBytes(system.storage.documentBytes)} />
                  </div>

                  <Card className="p-4 gap-3">
                    <h3 className="text-sm font-medium">Integrations and configuration</h3>
                    <ul className="divide-y">
                      {system.configuration.map((c) => (
                        <li key={c.key} className="flex items-center justify-between gap-3 py-2 text-sm">
                          <div><div>{c.label}</div><div className="text-xs text-muted-foreground">{c.hint}</div></div>
                          <StatusBadge ok={c.ok} okLabel="Configured" badLabel="Not configured" />
                        </li>
                      ))}
                    </ul>
                    {!system.storage.persistent && (
                      <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />Uploaded documents are on temporary storage and can be lost when the server restarts.</p>
                    )}
                  </Card>

                  <Card className="p-4 gap-3">
                    <div>
                      <h3 className="text-sm font-medium">API activity</h3>
                      <p className="text-xs text-muted-foreground">Measured in server memory since it last started ({new Date(system.runtime.startedAt).toLocaleString()}); it resets when the server restarts or sleeps. Response times are upper bounds of the bucket they fall in.</p>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div><div className="text-xs text-muted-foreground">Requests (last hour)</div><div className="font-semibold tabular-nums">{formatNumber(system.runtime.lastHour.requests)}</div></div>
                      <div><div className="text-xs text-muted-foreground">Server errors (last hour)</div><div className="font-semibold tabular-nums">{formatNumber(system.runtime.lastHour.serverErrors)} <span className="text-xs font-normal text-muted-foreground">({(system.runtime.lastHour.serverErrorRate * 100).toFixed(1)}%)</span></div></div>
                      <div><div className="text-xs text-muted-foreground">Typical response (p50 / p95)</div><div className="font-semibold tabular-nums">{latency(system.runtime.lastHour.p50)} / {latency(system.runtime.lastHour.p95)}</div></div>
                      <div><div className="text-xs text-muted-foreground">Requests since start</div><div className="font-semibold tabular-nums">{formatNumber(system.runtime.sinceStart.requests)}</div></div>
                    </div>
                    <TimeSeriesChart
                      title="Requests per minute (last hour)"
                      points={system.runtime.lastHour.perMinute.map((m) => ({ date: m.minute, value: m.requests }))}
                      label={(k) => new Date(k).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      period="in the last hour"
                    />
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <BarList title="Busiest endpoints" rows={system.runtime.busiestRoutes.map((r) => ({ label: r.route, value: r.requests }))} empty="No requests recorded yet." />
                      <BarList title="Slowest endpoints (avg)" format={(n) => `${n} ms`} rows={system.runtime.slowestRoutes.map((r) => ({ label: r.route, value: Math.round(r.avgMs) }))} empty="Not enough requests to judge yet." />
                      <BarList title="Endpoints with server errors" rows={system.runtime.erroringRoutes.map((r) => ({ label: r.route, value: r.errors }))} empty="No server errors since start." />
                    </div>
                  </Card>

                  <Card className="p-4 gap-3">
                    <h3 className="text-sm font-medium">Database</h3>
                    <p className="text-xs text-muted-foreground">{system.database.migrationsApplied} migrations applied; latest {system.database.latestMigration ?? '-'}. Totals: {formatNumber(system.database.totals.facilities)} facilities, {formatNumber(system.database.totals.users)} users, {formatNumber(system.database.totals.patients)} patients, {formatNumber(system.database.totals.consultations)} consultations, {formatNumber(system.database.totals.auditEntries)} audit entries.</p>
                    <BarList title="Largest tables (size)" rows={system.database.largestTables.map((t) => ({ label: t.name, value: t.bytes, note: `~${formatNumber(t.rows)} rows` }))} format={formatBytes} />
                  </Card>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {detailsId && <FacilityDetailsModal clinicId={detailsId} onClose={() => setDetailsId(null)} />}
    </div>
  );
}
