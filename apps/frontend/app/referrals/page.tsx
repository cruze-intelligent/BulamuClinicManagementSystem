'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Printer, UserPlus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { facilityTypeLabel } from '@/lib/facility-types';
import { useAuth } from '@/lib/useAuth';
import { openPdfWithAuth } from '@/lib/download';

type Referral = {
  id: string;
  direction: 'SENT' | 'RECEIVED';
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'COMPLETED' | 'CANCELLED';
  urgency: 'ROUTINE' | 'URGENT' | 'EMERGENCY';
  reason: string;
  clinicalSummary: string | null;
  responseNote: string | null;
  receivingPatientId: string | null;
  referredBy: string | null;
  createdAt: string;
  respondedAt: string | null;
  fromClinic: { name: string; phone: string | null };
  toClinic: { name: string; phone: string | null };
  patient: { name: string; phone: string | null; sexAge: string | null; address: string | null; nextOfKin: string | null; allergies: string | null };
};

const API = process.env.NEXT_PUBLIC_API_URL;
const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

const STATUS_STYLE: Record<Referral['status'], string> = {
  PENDING: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
  ACCEPTED: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-300',
  COMPLETED: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  DECLINED: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-300',
  CANCELLED: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};
const URGENCY_STYLE: Record<Referral['urgency'], string> = {
  ROUTINE: '',
  URGENT: 'bg-amber-600 text-white',
  EMERGENCY: 'bg-rose-700 text-white',
};

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function ReferralsPage() {
  return (
    <Suspense fallback={<div className="p-8">Loading...</div>}>
      <Referrals />
    </Suspense>
  );
}

function Referrals() {
  const { user } = useAuth();
  const clinicId = user?.clinicId as string | undefined;
  const role = user?.role as string | undefined;
  const canRefer = role === 'DOCTOR' || role === 'NURSE' || role === 'ADMIN';
  const searchParams = useSearchParams();
  const presetPatient = searchParams.get('patientId') || '';

  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [clinics, setClinics] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'RECEIVED' | 'SENT'>(presetPatient ? 'SENT' : 'RECEIVED');
  const [showForm, setShowForm] = useState(!!presetPatient);
  const [form, setForm] = useState({ patientId: presetPatient, toClinicId: '', reason: '', urgency: 'ROUTINE', clinicalSummary: '', consentConfirmed: false });
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clinicId) return;
    try {
      const requests = [fetch(`${API}/referrals/${clinicId}`, { headers: authHeaders() })];
      if (canRefer) {
        requests.push(fetch(`${API}/clinics`, { headers: authHeaders() }), fetch(`${API}/patients/${clinicId}`, { headers: authHeaders() }));
      }
      const [referralsData, clinicsData, patientsData] = await Promise.all(requests.map((r) => r.then((res) => res.json())));
      if (referralsData.success) setReferrals(referralsData.referrals);
      if (clinicsData?.success) setClinics(clinicsData.clinics.filter((c: any) => c.id !== clinicId));
      if (patientsData?.success) setPatients(patientsData.patients);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [clinicId, canRefer]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.consentConfirmed) return alert('Confirm that the patient agreed to the referral and to their details being shared.');
    setSaving(true);
    try {
      const res = await fetch(`${API}/referrals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Could not create the referral');
      setShowForm(false);
      setForm({ patientId: '', toClinicId: '', reason: '', urgency: 'ROUTINE', clinicalSummary: '', consentConfirmed: false });
      setTab('SENT');
      await load();
      if (confirm('Referral sent. Print the referral letter for the patient to carry?')) printLetter(data.referral.id);
    } catch (error: any) {
      alert(error.message);
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (r: Referral, status: string) => {
    let note: string | null | undefined;
    if (status === 'DECLINED') {
      note = prompt(`Why can your facility not take ${r.patient.name}? (${r.fromClinic.name} will be told, so they can arrange care elsewhere)`);
      if (!note?.trim()) return;
    } else if (status === 'ACCEPTED') {
      note = prompt(`Accept the referral of ${r.patient.name}. Add a note for ${r.fromClinic.name} (optional - e.g. when to come, whom to ask for):`, '');
      if (note === null) return;
    } else if (status === 'CANCELLED') {
      if (!confirm(`Cancel the referral of ${r.patient.name} to ${r.toClinic.name}? They will be told.`)) return;
    }
    setBusyId(r.id);
    try {
      const res = await fetch(`${API}/referrals/${r.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status, note: note || undefined }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Could not update the referral');
      await load();
    } catch (error: any) {
      alert(error.message);
    } finally {
      setBusyId(null);
    }
  };

  const register = async (r: Referral) => {
    setBusyId(r.id);
    try {
      const res = await fetch(`${API}/referrals/${r.id}/register-patient`, { method: 'POST', headers: authHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Could not register the patient');
      await load();
      window.location.href = `/patients/view?id=${data.patient.id}`;
    } catch (error: any) {
      alert(error.message);
    } finally {
      setBusyId(null);
    }
  };

  const printLetter = (id: string) =>
    openPdfWithAuth(`${API}/referrals/${id}/letter`, localStorage.getItem('token'), `referral-${id.slice(0, 8)}.pdf`).catch((e) => alert(e.message));

  const shown = referrals.filter((r) => r.direction === tab);
  const waiting = referrals.filter((r) => r.direction === 'RECEIVED' && r.status === 'PENDING').length;

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8 dark:bg-slate-950">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">Referrals</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Patients referred to and from your facility, with the letter and the other facility&apos;s reply.</p>
          </div>
          {canRefer && <Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Cancel' : '+ Refer a patient'}</Button>}
        </div>

        {showForm && canRefer && (
          <Card className="mb-6 p-6">
            <form onSubmit={submit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="patientId">Patient</Label>
                  <Select id="patientId" required value={form.patientId} onChange={(e) => setForm((f) => ({ ...f, patientId: e.target.value }))}>
                    <option value="">Select patient</option>
                    {patients.map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.phone ? ` - ${p.phone}` : ''}</option>)}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="toClinicId">Refer to</Label>
                  <Select id="toClinicId" required value={form.toClinicId} onChange={(e) => setForm((f) => ({ ...f, toClinicId: e.target.value }))}>
                    <option value="">Select facility</option>
                    {clinics.map((c: any) => (
                      <option key={c.id} value={c.id}>{c.name} ({facilityTypeLabel(c.facilityType)}{c.district ? `, ${c.district}` : ''})</option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <Label htmlFor="reason">Reason for referral</Label>
                  <Textarea id="reason" required rows={2} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="e.g. Obstructed labour - needs caesarean section" />
                </div>
                <div>
                  <Label htmlFor="urgency">Urgency</Label>
                  <Select id="urgency" value={form.urgency} onChange={(e) => setForm((f) => ({ ...f, urgency: e.target.value }))}>
                    <option value="ROUTINE">Routine</option>
                    <option value="URGENT">Urgent</option>
                    <option value="EMERGENCY">Emergency</option>
                  </Select>
                </div>
              </div>
              <div>
                <Label htmlFor="summary">Clinical summary for the receiving clinician</Label>
                <Textarea
                  id="summary" rows={4} value={form.clinicalSummary}
                  onChange={(e) => setForm((f) => ({ ...f, clinicalSummary: e.target.value }))}
                  placeholder="History, examination findings, vital signs, investigations and results, treatment given (drug, dose, time)."
                />
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">The patient&apos;s allergies are added to the letter automatically.</p>
              </div>
              <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
                <input type="checkbox" className="mt-1" checked={form.consentConfirmed} onChange={(e) => setForm((f) => ({ ...f, consentConfirmed: e.target.checked }))} />
                <span>The patient (or their caregiver) agreed to be referred, and to their details and this summary being shared with the receiving facility.</span>
              </label>
              <Button type="submit" disabled={saving || !form.consentConfirmed} className="w-full">{saving ? 'Sending...' : 'Send referral'}</Button>
            </form>
          </Card>
        )}

        <div role="tablist" aria-label="Referrals" className="mb-4 flex gap-1 border-b border-slate-200 dark:border-slate-800">
          {(['RECEIVED', 'SENT'] as const).map((t) => (
            <button
              key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm ${tab === t ? 'border-emerald-700 font-medium text-slate-950 dark:text-slate-50' : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'}`}
            >
              {t === 'RECEIVED' ? <ArrowDownLeft className="size-4" aria-hidden="true" /> : <ArrowUpRight className="size-4" aria-hidden="true" />}
              {t === 'RECEIVED' ? 'Received' : 'Sent'}
              {t === 'RECEIVED' && waiting > 0 && <span className="rounded-full bg-amber-600 px-1.5 text-[11px] font-semibold leading-5 text-white">{waiting}</span>}
            </button>
          ))}
        </div>

        {loading ? (
          <p>Loading...</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{tab === 'RECEIVED' ? 'No patients have been referred to your facility yet.' : 'Your facility has not referred any patients yet.'}</p>
        ) : (
          <div className="space-y-3">
            {shown.map((r) => {
              const received = r.direction === 'RECEIVED';
              const busy = busyId === r.id;
              return (
                <Card key={r.id} className="p-4" data-testid="referral">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{r.patient.name}</p>
                        {r.urgency !== 'ROUTINE' && (
                          <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold ${URGENCY_STYLE[r.urgency]}`}>
                            <AlertTriangle className="size-3" aria-hidden="true" />{r.urgency === 'EMERGENCY' ? 'Emergency' : 'Urgent'}
                          </span>
                        )}
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status]}`}>{r.status.charAt(0) + r.status.slice(1).toLowerCase()}</span>
                      </div>
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        {received ? `From ${r.fromClinic.name}` : `To ${r.toClinic.name}`} · {when(r.createdAt)}{r.referredBy ? ` · by ${r.referredBy}` : ''}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {[r.patient.sexAge, r.patient.phone, r.patient.address, r.patient.nextOfKin ? `Next of kin: ${r.patient.nextOfKin}` : null].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </div>

                  <dl className="mt-3 space-y-2 text-sm">
                    <div><dt className="text-xs font-medium uppercase text-slate-500">Reason</dt><dd>{r.reason}</dd></div>
                    {r.patient.allergies && (
                      <div><dt className="text-xs font-medium uppercase text-slate-500">Allergies</dt><dd className={r.patient.allergies.startsWith('No known') ? '' : 'font-medium text-rose-700 dark:text-rose-400'}>{r.patient.allergies}</dd></div>
                    )}
                    {r.clinicalSummary && (
                      <div><dt className="text-xs font-medium uppercase text-slate-500">Clinical summary</dt><dd className="whitespace-pre-wrap">{r.clinicalSummary}</dd></div>
                    )}
                    {r.responseNote && (
                      <div className="rounded-md bg-slate-100 p-2 dark:bg-slate-800">
                        <dt className="text-xs font-medium uppercase text-slate-500">Reply from {r.toClinic.name}{r.respondedAt ? ` · ${when(r.respondedAt)}` : ''}</dt>
                        <dd>{r.responseNote}</dd>
                      </div>
                    )}
                  </dl>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {canRefer && (
                      <Button size="sm" variant="outline" onClick={() => printLetter(r.id)}><Printer className="size-4" aria-hidden="true" /> Referral letter</Button>
                    )}
                    {received && r.status === 'PENDING' && canRefer && (
                      <>
                        <Button size="sm" disabled={busy} onClick={() => setStatus(r, 'ACCEPTED')}>Accept</Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus(r, 'DECLINED')}>Decline</Button>
                      </>
                    )}
                    {received && r.status === 'ACCEPTED' && canRefer && (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus(r, 'COMPLETED')}>Mark seen / completed</Button>
                    )}
                    {received && (r.status === 'PENDING' || r.status === 'ACCEPTED' || r.status === 'COMPLETED') && (
                      r.receivingPatientId ? (
                        <Link href={`/patients/view?id=${r.receivingPatientId}`} className="inline-flex h-8 items-center rounded-md border px-3 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">Open patient</Link>
                      ) : (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => register(r)}><UserPlus className="size-4" aria-hidden="true" /> Register at our facility</Button>
                      )
                    )}
                    {!received && (r.status === 'PENDING' || r.status === 'ACCEPTED') && canRefer && (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStatus(r, 'CANCELLED')}>Cancel referral</Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
