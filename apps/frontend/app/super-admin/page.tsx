'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Crown,
  DatabaseZap,
  MessageSquare,
  PauseCircle,
  PlayCircle,
  Plus,
  Settings2,
  ShieldAlert,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/useAuth';
import { FACILITY_TYPES, facilityTypeLabel } from '@/lib/facility-types';
import { Select } from '@/components/ui/select';


type Facility = {
  id: string;
  facilityCode: string;
  name: string;
  facilityType: string;
  phone: string;
  address: string;
  isActive: boolean;
  createdAt: string;
  users: number;
  patients: number;
  admin: { name: string; email: string; isActive: boolean } | null;
  subscription: { status: string; plan: 'STANDARD' | 'CUSTOM'; amount: number; trialEndsAt: string; currentPeriodEnd: string | null } | null;
};

type PendingFacility = {
  id: string;
  facilityCode: string;
  name: string;
  facilityType: string;
  phone: string;
  address: string;
  district: string | null;
  subCounty: string | null;
  parish: string | null;
  createdAt: string;
  admin: { name: string; email: string } | null;
};

type Overview = {
  clinicCount: number;
  activeClinicCount: number;
  userCount: number;
  patientCount: number;
  appointmentCount: number;
  consultationCount: number;
  revenue: number;
  evaluationEndsAt: string;
  clinics: Facility[];
};

const emptyForm = {
  name: '',
  facilityType: 'CLINIC',
  phone: '',
  address: '',
  adminName: '',
  adminEmail: '',
  adminPassword: '',
};

const facilityLabel = facilityTypeLabel;

export default function SuperAdminPage() {
  const { hasRole } = useAuth();
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [pending, setPending] = useState<PendingFacility[]>([]);
  const [formData, setFormData] = useState(emptyForm);
  const [feedback, setFeedback] = useState<{ id: string; body: string; authorName: string; authorRole: string; clinicName: string; createdAt: string }[]>([]);

  const fetchOverview = async () => {
    const token = localStorage.getItem('token');
    setLoading(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/super-admin/overview`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success) setOverview(data.overview);
    } finally {
      setLoading(false);
    }
  };

  const fetchPending = async () => {
    const token = localStorage.getItem('token');
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/super-admin/pending-clinics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json();
    if (data.success) setPending(data.clinics);
  };

  const fetchFeedback = async () => {
    const token = localStorage.getItem('token');
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/super-admin/feedback`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json();
    if (data.success) setFeedback(data.comments);
  };

  useEffect(() => {
    if (!hasRole('SUPER_ADMIN')) {
      router.push('/dashboard');
      return;
    }
    fetchOverview();
    fetchPending();
    fetchFeedback();
  }, [hasRole, router]);

  const approveFacility = async (id: string) => {
    const token = localStorage.getItem('token');
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/clinics/${id}/approve`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json();
    if (data.success) {
      await Promise.all([fetchPending(), fetchOverview()]);
    } else {
      alert(data.error || 'Could not approve facility');
    }
  };

  const rejectFacility = async (id: string) => {
    const reason = window.prompt('Reason for rejecting this facility (optional):') || undefined;
    const token = localStorage.getItem('token');
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/clinics/${id}/reject`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ reason }),
    });
    const data = await response.json();
    if (data.success) {
      await fetchPending();
    } else {
      alert(data.error || 'Could not reject facility');
    }
  };

  const createFacility = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('token');

    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/clinics/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(formData),
    });

    const data = await response.json();
    if (data.success) {
      setShowForm(false);
      setFormData(emptyForm);
      await fetchOverview();
      alert(`Facility authorized. Login: ${formData.adminEmail} / ${formData.adminPassword}`);
    } else {
      alert(data.error || 'Error creating facility');
    }
  };

  const updateFacilityStatus = async (facility: Facility) => {
    const token = localStorage.getItem('token');
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/clinics/${facility.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ isActive: !facility.isActive }),
    });
    const data = await response.json();
    if (data.success) await fetchOverview();
    else alert(data.error || 'Could not update facility status');
  };

  const deleteFacility = async (facility: Facility) => {
    const typed = window.prompt(
      `This permanently removes ${facility.name} from Bulamu and deactivates its staff. This cannot be undone from this screen.\n\nType the facility name to confirm: ${facility.name}`
    );
    if (typed === null) return;
    if (typed !== facility.name) {
      alert('Facility name did not match. Deletion cancelled.');
      return;
    }

    const token = localStorage.getItem('token');
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/clinics/${facility.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ confirmName: typed }),
    });
    const data = await response.json();
    if (data.success) await fetchOverview();
    else alert(data.error || 'Could not delete facility');
  };

  const managePlan = async (facility: Facility) => {
    const isCustom = facility.subscription?.plan === 'CUSTOM';
    const wantsCustom = window.confirm(
      isCustom
        ? `${facility.name} is on a custom plan. Click OK to update its custom amount/notes, or Cancel to move it back to the standard plan.`
        : `${facility.name} is on the standard plan. Click OK to set it up with a custom plan, or Cancel to leave it standard.`
    );

    const token = localStorage.getItem('token');

    if (!wantsCustom) {
      if (!isCustom) return;
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/billing/plan/${facility.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan: 'STANDARD' }),
      });
      await fetchOverview();
      return;
    }

    const amountInput = window.prompt('Monthly amount for this facility (UGX):', String(facility.subscription?.amount || 100000));
    if (amountInput === null) return;
    const notes = window.prompt('What does this custom plan cover (internal note)?') || '';

    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/billing/plan/${facility.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ plan: 'CUSTOM', amount: Number(amountInput) || undefined, notes }),
    });
    const data = await response.json();
    if (data.success) await fetchOverview();
    else alert(data.error || 'Could not update plan');
  };

  if (!hasRole('SUPER_ADMIN')) return null;

  const stats = [
    { label: 'Facilities', value: overview?.clinicCount || 0, icon: Building2 },
    { label: 'Active Facilities', value: overview?.activeClinicCount || 0, icon: CheckCircle2 },
    { label: 'Active Users', value: overview?.userCount || 0, icon: Users },
    { label: 'Patients', value: overview?.patientCount || 0, icon: Activity },
    { label: 'Consultations', value: overview?.consultationCount || 0, icon: ClipboardCheck },
    { label: 'Revenue', value: `UGX ${(overview?.revenue || 0).toLocaleString()}`, icon: DatabaseZap },
  ];

  return (
    <main className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold uppercase text-emerald-700">
            <Crown className="size-4" aria-hidden="true" />
            Facility Administration
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">Facility authorization console</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
            Authorize medical facilities, monitor national readiness, suspend access when needed, and verify the
            two-week evaluation environment across facility types.
          </p>
        </div>
        <Button onClick={() => setShowForm((value) => !value)}>
          <Plus className="size-4" aria-hidden="true" />
          {showForm ? 'Close form' : 'Authorize facility'}
        </Button>
      </header>

      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {stats.map((stat) => (
          <Card key={stat.label} className="gap-3 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase text-slate-500 dark:text-slate-400">{stat.label}</p>
              <stat.icon className="size-4 text-emerald-700" aria-hidden="true" />
            </div>
            <p className="text-2xl font-semibold text-slate-950 dark:text-slate-50">{stat.value}</p>
          </Card>
        ))}
      </section>

      {pending.length > 0 && (
        <Card className="rounded-lg border-amber-200 bg-amber-50 p-5">
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-5 text-amber-700" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Pending approvals ({pending.length})</h2>
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Self-registered facilities awaiting your review.</p>
          <div className="mt-4 space-y-3">
            {pending.map((facility) => (
              <div key={facility.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-white dark:bg-slate-900 p-4">
                <div>
                  <p className="font-medium text-slate-950 dark:text-slate-50">{facility.name} <span className="font-mono text-xs font-normal text-slate-400">({facility.facilityCode})</span></p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{facilityLabel(facility.facilityType)} - {facility.address}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Admin: {facility.admin?.name || 'Unknown'} ({facility.admin?.email || 'n/a'})
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => approveFacility(facility.id)}>
                    <ThumbsUp className="size-4" aria-hidden="true" />
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => rejectFacility(facility.id)}>
                    <ThumbsDown className="size-4" aria-hidden="true" />
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card className="rounded-lg p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Authorized facilities</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">Includes clinics, hospitals, labs, imaging centres, pharmacies, outreach, and mobile units.</p>
            </div>
            {loading && <span className="text-sm text-slate-500 dark:text-slate-400">Loading...</span>}
          </div>
          <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800 text-xs uppercase text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Facility</th>
                  <th className="px-4 py-3">Facility ID</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Admin</th>
                  <th className="px-4 py-3">Records</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {(overview?.clinics || []).map((facility) => (
                  <tr key={facility.id} className="bg-white dark:bg-slate-900">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-950 dark:text-slate-50">{facility.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{facility.address}</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-300">{facility.facilityCode}</td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                      {facilityLabel(facility.facilityType)}
                      {facility.subscription?.plan === 'CUSTOM' && (
                        <span className="ml-2 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-400">Custom plan</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-slate-800 dark:text-slate-200">{facility.admin?.name || 'Not assigned'}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{facility.admin?.email || 'Create admin to activate'}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                      {facility.patients} patients / {facility.users} users
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${
                        facility.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                      }`}>
                        {facility.isActive ? 'Active' : 'Suspended'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => updateFacilityStatus(facility)}>
                          {facility.isActive ? <PauseCircle className="size-4" /> : <PlayCircle className="size-4" />}
                          {facility.isActive ? 'Suspend' : 'Reactivate'}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => managePlan(facility)}>
                          <Settings2 className="size-4" />
                          Plan
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/50"
                          onClick={() => deleteFacility(facility)}
                        >
                          <Trash2 className="size-4" />
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="rounded-lg p-5">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Research alignment</h2>
          <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-400">
            {[
              'HMIS 105 outpatient reporting',
              'FHIR R4 patient bundle export',
              'Offline-first local queue and sync',
              'Tier 2 edge clinic deployment path',
              'Role-based access for facility teams',
              'Centralized governance and authorization',
            ].map((item) => (
              <div key={item} className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-700" aria-hidden="true" />
                <span>{item}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Two-week evaluation ends:{' '}
            <strong>{overview?.evaluationEndsAt ? new Date(overview.evaluationEndsAt).toLocaleDateString() : 'after authorization'}</strong>
          </div>
        </Card>
      </section>

      <Card className="rounded-lg p-5">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-4 text-emerald-700" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Feedback inbox</h2>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Also emailed to the Bulamu admin inbox as it comes in.</p>
        {feedback.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">No feedback submitted yet.</p>
        ) : (
          <div className="mt-4 max-h-80 space-y-3 overflow-y-auto">
            {feedback.map((item) => (
              <div key={item.id} className="rounded-md border border-slate-200 dark:border-slate-800 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {item.authorName} <span className="font-normal text-slate-400">- {item.clinicName}</span>
                  </p>
                  <p className="text-xs text-slate-400">{new Date(item.createdAt).toLocaleString()}</p>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-400">{item.body}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {showForm && (
        <Card className="rounded-lg p-5">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Authorize a medical facility</h2>
          <form onSubmit={createFacility} className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="name">Facility name</Label>
              <Input id="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
            </div>
            <div>
              <Label htmlFor="facilityType">Facility type</Label>
              <Select
                id="facilityType" className="mt-2"
                value={formData.facilityType}
                onChange={(e) => setFormData({ ...formData, facilityType: e.target.value })}
              >
                {FACILITY_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="phone">Facility phone</Label>
              <Input id="phone" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} required />
            </div>
            <div>
              <Label htmlFor="address">Location</Label>
              <Input id="address" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} required />
            </div>
            <div>
              <Label htmlFor="adminName">Facility admin name</Label>
              <Input id="adminName" value={formData.adminName} onChange={(e) => setFormData({ ...formData, adminName: e.target.value })} required />
            </div>
            <div>
              <Label htmlFor="adminEmail">Facility admin email</Label>
              <Input id="adminEmail" type="email" value={formData.adminEmail} onChange={(e) => setFormData({ ...formData, adminEmail: e.target.value })} required />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="adminPassword">Temporary admin password</Label>
              <Input id="adminPassword" type="password" value={formData.adminPassword} onChange={(e) => setFormData({ ...formData, adminPassword: e.target.value })} required />
            </div>
            <div className="md:col-span-2">
              <Button type="submit" className="w-full">Authorize facility and create admin</Button>
            </div>
          </form>
        </Card>
      )}
    </main>
  );
}
