'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function ReferralsPage() {
  const [referrals, setReferrals] = useState<any[]>([]);
  const [clinics, setClinics] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ patientId: '', toClinicId: '', reason: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const authHeaders = () => ({
    Authorization: `Bearer ${localStorage.getItem('token')}`,
  });

  const fetchData = async () => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    try {
      const [referralsRes, clinicsRes, patientsRes] = await Promise.all([
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/referrals/${user.clinicId}`, { headers: authHeaders() }),
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/clinics`, { headers: authHeaders() }),
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/patients/${user.clinicId}`, { headers: authHeaders() }),
      ]);
      const referralsData = await referralsRes.json();
      const clinicsData = await clinicsRes.json();
      const patientsData = await patientsRes.json();

      if (referralsData.success) setReferrals(referralsData.referrals);
      if (clinicsData.success) setClinics(clinicsData.clinics.filter((c: any) => c.id !== user.clinicId));
      if (patientsData.success) setPatients(patientsData.patients);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/referrals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(formData),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to create referral');

      setShowForm(false);
      setFormData({ patientId: '', toClinicId: '', reason: '' });
      fetchData();
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/referrals/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status }),
      });
      fetchData();
    } catch (error) {
      alert('Error updating referral');
    }
  };

  return (
    <div className="min-h-screen p-8 bg-slate-50">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold">Facility Referrals</h1>
            <p className="text-sm text-slate-500">Refer complicated cases up the facility hierarchy</p>
          </div>
          <Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Cancel' : '+ New Referral'}</Button>
        </div>

        {showForm && (
          <Card className="p-6 mb-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="patientId">Patient</Label>
                <select
                  id="patientId"
                  required
                  value={formData.patientId}
                  onChange={(e) => setFormData((f) => ({ ...f, patientId: e.target.value }))}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                >
                  <option value="">Select patient</option>
                  {patients.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="toClinicId">Refer To</Label>
                <select
                  id="toClinicId"
                  required
                  value={formData.toClinicId}
                  onChange={(e) => setFormData((f) => ({ ...f, toClinicId: e.target.value }))}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                >
                  <option value="">Select facility</option>
                  {clinics.map((c: any) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.facilityType})</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="reason">Reason</Label>
                <Input
                  id="reason"
                  required
                  value={formData.reason}
                  onChange={(e) => setFormData((f) => ({ ...f, reason: e.target.value }))}
                  placeholder="e.g. Requires surgical intervention"
                />
              </div>
              <Button type="submit" disabled={saving} className="w-full">
                {saving ? 'Saving...' : 'Create Referral'}
              </Button>
            </form>
          </Card>
        )}

        {loading ? (
          <p>Loading...</p>
        ) : referrals.length === 0 ? (
          <p className="text-muted-foreground">No referrals yet</p>
        ) : (
          <div className="space-y-3">
            {referrals.map((r: any) => (
              <Card key={r.id} className="p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold">{r.patient.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {r.fromClinic.name} → {r.toClinic.name}
                    </p>
                    <p className="text-sm mt-1">{r.reason}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className="text-xs px-2 py-1 rounded bg-blue-100">{r.status}</span>
                    {r.status === 'PENDING' && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => updateStatus(r.id, 'ACCEPTED')}>Accept</Button>
                        <Button size="sm" variant="destructive" onClick={() => updateStatus(r.id, 'CANCELLED')}>Cancel</Button>
                      </div>
                    )}
                    {r.status === 'ACCEPTED' && (
                      <Button size="sm" onClick={() => updateStatus(r.id, 'COMPLETED')}>Mark Completed</Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
