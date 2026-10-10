'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { BedDouble, Plus, Settings2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/useAuth';
import { WARD_TYPES, wardTypeLabel } from '@/lib/wards';

const API = process.env.NEXT_PUBLIC_API_URL;
const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

type Ward = { id: string; name: string; type: string; beds: number; occupied: number; isActive: boolean };
type Admission = {
  id: string; bed: string | null; reason: string; admittedAt: string; daysAdmitted: number;
  ward: { id: string; name: string }; attendingDoctor: { name: string } | null;
  patient: { id: string; name: string; sexAge: string | null; allergies: string };
};

export default function WardsPage() {
  return (
    <Suspense fallback={<div className="p-8">Loading...</div>}>
      <Wards />
    </Suspense>
  );
}

function Wards() {
  const { user } = useAuth();
  const role = user?.role as string | undefined;
  const clinicId = user?.clinicId as string | undefined;
  const isAdmin = role === 'ADMIN';
  const presetPatient = useSearchParams().get('admit') || '';

  const [wards, setWards] = useState<Ward[]>([]);
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdmit, setShowAdmit] = useState(!!presetPatient);
  const [showManage, setShowManage] = useState(false);
  const [admit, setAdmit] = useState({ patientId: presetPatient, wardId: '', bed: '', reason: '', admissionIcd10Code: '', attendingDoctorId: '' });
  const [newWard, setNewWard] = useState({ name: '', type: 'GENERAL', beds: '10' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!clinicId) return;
    try {
      const [w, a, p, u] = await Promise.all([
        fetch(`${API}/wards`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/admissions`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/patients/${clinicId}`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/users/${clinicId}`, { headers: authHeaders() }).then((r) => r.json()),
      ]);
      if (w.success) setWards(w.wards);
      if (a.success) setAdmissions(a.admissions);
      if (p.success) setPatients(p.patients);
      if (u.success) setDoctors(u.users.filter((x: any) => x.role === 'DOCTOR' && x.isActive));
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    load();
  }, [load]);

  const post = async (url: string, body: unknown, method = 'POST') => {
    const res = await fetch(`${API}${url}`, { method, headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Something went wrong');
    return data;
  };

  const submitAdmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = await post('/admissions', { ...admit, attendingDoctorId: admit.attendingDoctorId || undefined, bed: admit.bed || undefined, admissionIcd10Code: admit.admissionIcd10Code || undefined });
      window.location.href = `/wards/admission?id=${data.admission.id}`;
    } catch (error: any) {
      alert(error.message);
    } finally {
      setSaving(false);
    }
  };

  const addWard = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await post('/wards', { ...newWard, beds: Number(newWard.beds) });
      setNewWard({ name: '', type: 'GENERAL', beds: '10' });
      await load();
    } catch (error: any) {
      alert(error.message);
    }
  };

  const editWard = async (ward: Ward, change: Partial<Ward>) => {
    try {
      await post(`/wards/${ward.id}`, change, 'PATCH');
      await load();
    } catch (error: any) {
      alert(error.message);
    }
  };

  const active = wards.filter((w) => w.isActive);
  const admittedIds = new Set(admissions.map((a) => a.patient.id));
  const totalBeds = active.reduce((s, w) => s + w.beds, 0);

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8 dark:bg-slate-950">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">Wards</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {admissions.length} admitted · {Math.max(0, totalBeds - admissions.length)} of {totalBeds} beds free
            </p>
          </div>
          <div className="flex gap-2">
            {isAdmin && (
              <Button variant="outline" onClick={() => setShowManage((v) => !v)}><Settings2 className="size-4" aria-hidden="true" /> {showManage ? 'Done' : 'Set up wards'}</Button>
            )}
            {active.length > 0 && <Button onClick={() => setShowAdmit((v) => !v)}><Plus className="size-4" aria-hidden="true" /> {showAdmit ? 'Cancel' : 'Admit a patient'}</Button>}
          </div>
        </div>

        {!loading && wards.length === 0 && (
          <Card className="mb-6 p-6 text-sm">
            {isAdmin ? 'No wards yet. Use "Set up wards" to add your wards and their beds, then clinicians can admit patients.' : 'No wards have been set up yet. Ask your facility administrator to add them under Wards.'}
          </Card>
        )}

        {showManage && isAdmin && (
          <Card className="mb-6 p-6">
            <h2 className="mb-3 font-semibold">Wards and beds</h2>
            <form onSubmit={addWard} className="mb-4 grid gap-3 sm:grid-cols-4">
              <div className="sm:col-span-2"><Label htmlFor="ward-name">Ward name</Label><Input id="ward-name" required value={newWard.name} onChange={(e) => setNewWard((w) => ({ ...w, name: e.target.value }))} placeholder="e.g. Maternity Ward" /></div>
              <div><Label htmlFor="ward-type">Type</Label>
                <Select id="ward-type" value={newWard.type} onChange={(e) => setNewWard((w) => ({ ...w, type: e.target.value }))}>
                  {WARD_TYPES.map((t) => <option key={t} value={t}>{wardTypeLabel(t)}</option>)}
                </Select>
              </div>
              <div><Label htmlFor="ward-beds">Beds</Label><Input id="ward-beds" type="number" min={1} max={500} required value={newWard.beds} onChange={(e) => setNewWard((w) => ({ ...w, beds: e.target.value }))} /></div>
              <Button type="submit" className="sm:col-span-4 sm:w-fit">Add ward</Button>
            </form>
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {wards.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>{w.name} <span className="text-slate-500">· {wardTypeLabel(w.type)} · {w.occupied}/{w.beds} beds{w.isActive ? '' : ' · closed'}</span></span>
                  <span className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => { const beds = prompt(`Number of beds on ${w.name}:`, String(w.beds)); if (beds) editWard(w, { beds: Number(beds) }); }}>Beds</Button>
                    <Button size="sm" variant="ghost" onClick={() => editWard(w, { isActive: !w.isActive })}>{w.isActive ? 'Close ward' : 'Reopen'}</Button>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {showAdmit && (
          <Card className="mb-6 p-6">
            <h2 className="mb-3 font-semibold">Admit a patient</h2>
            <form onSubmit={submitAdmit} className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="admit-patient">Patient</Label>
                <Select id="admit-patient" required value={admit.patientId} onChange={(e) => setAdmit((a) => ({ ...a, patientId: e.target.value }))}>
                  <option value="">Select patient</option>
                  {patients.filter((p) => !admittedIds.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}{p.phone ? ` - ${p.phone}` : ''}</option>)}
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Label htmlFor="admit-ward">Ward</Label>
                  <Select id="admit-ward" required value={admit.wardId} onChange={(e) => setAdmit((a) => ({ ...a, wardId: e.target.value }))}>
                    <option value="">Select ward</option>
                    {active.map((w) => <option key={w.id} value={w.id} disabled={w.occupied >= w.beds}>{w.name} ({w.beds - w.occupied} free)</option>)}
                  </Select>
                </div>
                <div><Label htmlFor="admit-bed">Bed</Label><Input id="admit-bed" value={admit.bed} onChange={(e) => setAdmit((a) => ({ ...a, bed: e.target.value }))} placeholder="e.g. 4" /></div>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="admit-reason">Reason for admission / admitting diagnosis</Label>
                <Textarea id="admit-reason" required rows={2} value={admit.reason} onChange={(e) => setAdmit((a) => ({ ...a, reason: e.target.value }))} placeholder="e.g. Severe malaria with severe anaemia (Hb 5.2)" />
              </div>
              <div><Label htmlFor="admit-icd">ICD-10 code (optional)</Label><Input id="admit-icd" value={admit.admissionIcd10Code} onChange={(e) => setAdmit((a) => ({ ...a, admissionIcd10Code: e.target.value }))} placeholder="e.g. B50.8" /></div>
              <div>
                <Label htmlFor="admit-doctor">Attending doctor / clinical officer</Label>
                <Select id="admit-doctor" value={admit.attendingDoctorId} onChange={(e) => setAdmit((a) => ({ ...a, attendingDoctorId: e.target.value }))}>
                  <option value="">Not assigned</option>
                  {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
              </div>
              <Button type="submit" disabled={saving} className="sm:col-span-2">{saving ? 'Admitting...' : 'Admit'}</Button>
            </form>
          </Card>
        )}

        {loading ? <p>Loading...</p> : (
          <div className="grid gap-4 md:grid-cols-2">
            {active.map((w) => {
              const here = admissions.filter((a) => a.ward.id === w.id);
              return (
                <Card key={w.id} className="p-4" data-testid="ward">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h2 className="font-semibold">{w.name}</h2>
                      <p className="text-xs text-slate-500">{wardTypeLabel(w.type)}</p>
                    </div>
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${w.occupied >= w.beds ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'}`}>
                      {w.occupied}/{w.beds} beds{w.occupied >= w.beds ? ' - full' : ''}
                    </span>
                  </div>
                  {here.length === 0 ? (
                    <p className="text-sm text-slate-500">No patients on this ward.</p>
                  ) : (
                    <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                      {here.map((a) => (
                        <li key={a.id}>
                          <Link href={`/wards/admission?id=${a.id}`} className="flex items-start gap-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-900">
                            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded bg-slate-100 text-xs font-semibold dark:bg-slate-800">
                              {a.bed || <BedDouble className="size-4" aria-hidden="true" />}
                            </span>
                            <span className="min-w-0">
                              <span className="block font-medium">{a.patient.name} <span className="text-xs font-normal text-slate-500">{a.patient.sexAge}</span></span>
                              <span className="block truncate text-xs text-slate-600 dark:text-slate-400">{a.reason}</span>
                              <span className="block text-xs text-slate-500">Day {a.daysAdmitted}{a.attendingDoctor ? ` · ${a.attendingDoctor.name}` : ''}</span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
