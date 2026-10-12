'use client';

import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { cachePatients, removeLocalPatient } from '@/lib/local-first';

type Patient = {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  sex?: string | null;
  dateOfBirth?: string | null;
  village?: string | null;
  parish?: string | null;
  subCounty?: string | null;
  district?: string | null;
  nextOfKinName?: string | null;
  nextOfKinPhone?: string | null;
  [key: string]: any;
};

const FIELDS: Array<{ key: keyof Patient; label: string; type?: string; required?: boolean }> = [
  { key: 'name', label: 'Full name', required: true },
  { key: 'phone', label: 'Phone', type: 'tel', required: true },
  { key: 'email', label: 'Email (optional)', type: 'email' },
  { key: 'dateOfBirth', label: 'Date of birth', type: 'date' },
  { key: 'village', label: 'Village' },
  { key: 'parish', label: 'Parish' },
  { key: 'subCounty', label: 'Sub-county' },
  { key: 'district', label: 'District' },
  { key: 'nextOfKinName', label: 'Next of kin' },
  { key: 'nextOfKinPhone', label: 'Next of kin phone', type: 'tel' },
];

const formFrom = (patient: Patient) => ({
  ...Object.fromEntries(FIELDS.map(({ key }) => [key, (patient[key] as string | null | undefined) ?? ''])),
  dateOfBirth: patient.dateOfBirth ? String(patient.dateOfBirth).slice(0, 10) : '',
  sex: patient.sex ?? '',
}) as Record<string, string>;

/**
 * Correcting a patient's registration details, and (administrators only)
 * removing a patient registered by mistake. Clinical records are not edited here.
 */
export function PatientDetailsEditor({
  patient, canEdit, canDelete, onSaved, onDeleted,
}: {
  patient: Patient;
  canEdit: boolean;
  canDelete: boolean;
  onSaved: (patient: Patient) => void;
  onDeleted: () => void;
}) {
  const [mode, setMode] = useState<'idle' | 'edit' | 'delete'>('idle');
  const [form, setForm] = useState<Record<string, string>>(() => formFrom(patient));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!canEdit && !canDelete) return null;

  const request = async (method: 'PATCH' | 'DELETE', body?: unknown) => {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patients/${patient.id}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.error || 'Something went wrong - please try again');
    return data;
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { patient: saved } = await request('PATCH', form);
      // Keep this device's copy in step (lists read from it, including offline).
      await cachePatients([saved]).catch(() => {});
      onSaved(saved);
      setMode('idle');
    } catch (err: any) {
      setError(navigator.onLine ? err.message : 'You are offline - patient details can be changed when the connection returns.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      await request('DELETE');
      await removeLocalPatient(patient.id).catch(() => {});
      onDeleted();
    } catch (err: any) {
      setError(navigator.onLine ? err.message : 'You are offline - a patient can be deleted when the connection returns.');
      setBusy(false);
    }
  };

  return (
    <div className="mt-4">
      {mode === 'idle' && (
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <Button type="button" size="sm" variant="outline" onClick={() => { setForm(formFrom(patient)); setError(''); setMode('edit'); }}>
              <Pencil className="size-4" aria-hidden="true" /> Edit details
            </Button>
          )}
          {canDelete && (
            <Button type="button" size="sm" variant="outline" className="text-red-700 hover:text-red-800 dark:text-red-400" onClick={() => { setError(''); setMode('delete'); }}>
              <Trash2 className="size-4" aria-hidden="true" /> Delete patient
            </Button>
          )}
        </div>
      )}

      {mode === 'edit' && (
        <form onSubmit={save} className="rounded-lg border border-slate-200 p-4 dark:border-slate-800" aria-label="Edit patient details">
          <h2 className="font-semibold">Edit patient details</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">For correcting registration details. The change is recorded in the activity log.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {FIELDS.map(({ key, label, type, required }) => (
              <div key={key as string}>
                <Label htmlFor={`edit-${key as string}`}>{label}</Label>
                <Input
                  id={`edit-${key as string}`}
                  type={type ?? 'text'}
                  required={required}
                  max={type === 'date' ? new Date().toISOString().slice(0, 10) : undefined}
                  value={form[key as string]}
                  onChange={(e) => setForm((f) => ({ ...f, [key as string]: e.target.value }))}
                />
              </div>
            ))}
            <div>
              <Label htmlFor="edit-sex">Sex</Label>
              <Select id="edit-sex" value={form.sex} onChange={(e) => setForm((f) => ({ ...f, sex: e.target.value }))}>
                <option value="">Not recorded</option>
                <option value="FEMALE">Female</option>
                <option value="MALE">Male</option>
                <option value="OTHER">Other</option>
              </Select>
            </div>
          </div>
          {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
          <div className="mt-4 flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>{busy ? 'Saving...' : 'Save changes'}</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setMode('idle')} disabled={busy}>Cancel</Button>
          </div>
        </form>
      )}

      {mode === 'delete' && (
        <div role="alertdialog" aria-label="Delete patient" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          <p className="font-semibold">Delete {patient.name}?</p>
          <p className="mt-1">
            Use this only for a patient registered by mistake or for testing. They disappear from every list at this facility.
            Nothing is erased: the record is kept, and Bulamu support can restore it if this was a mistake.
          </p>
          {error && <p role="alert" className="mt-2 font-medium">{error}</p>}
          <div className="mt-3 flex gap-2">
            <Button type="button" size="sm" variant="destructive" onClick={remove} disabled={busy}>{busy ? 'Deleting...' : 'Delete patient'}</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setMode('idle')} disabled={busy}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
