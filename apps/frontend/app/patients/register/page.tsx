'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { createAppointmentOffline, createPatientOffline, getCurrentClinicId, getCurrentUser } from '@/lib/local-first';
import { activeDepartments, defaultDepartmentId, type Department } from '@/lib/departments';
import { formatTime, serverNow } from '@/lib/time';
import { LinkExistingPatient } from '@/components/link-existing-patient';
import { Select } from '@/components/ui/select';
import { BirthDateInput, birthDatePayload, emptyBirthDate, type BirthDateValue } from '@/components/birth-date-input';
import { DraftNote } from '@/components/draft-note';
import { useDraft } from '@/lib/drafts';

export default function RegisterPatient() {
  const [mode, setMode] = useState<'new' | 'link'>('new');

  return (
    <div className="min-h-screen p-8 bg-slate-50 dark:bg-slate-950">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6 flex gap-2 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setMode('new')}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${mode === 'new' ? 'bg-emerald-600 text-white' : 'text-slate-600 dark:text-slate-400'}`}
          >
            New patient
          </button>
          <button
            type="button"
            onClick={() => setMode('link')}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${mode === 'link' ? 'bg-emerald-600 text-white' : 'text-slate-600 dark:text-slate-400'}`}
          >
            Link existing patient
          </button>
        </div>

        {mode === 'new' ? <NewPatientForm /> : <LinkExistingPatient />}
      </div>
    </div>
  );
}

function NewPatientForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [sex, setSex] = useState<'FEMALE' | 'MALE' | 'OTHER' | ''>('');
  const [birth, setBirth] = useState<BirthDateValue>(emptyBirthDate);
  const [village, setVillage] = useState('');
  const [parish, setParish] = useState('');
  const [subCounty, setSubCounty] = useState('');
  const [district, setDistrict] = useState('');
  const [consentGiven, setConsentGiven] = useState(false);
  const [loading, setLoading] = useState(false);
  // Most patients are registered as they arrive: they join today's waiting queue at once.
  const [queueNow, setQueueNow] = useState(true);
  const [units, setUnits] = useState<Department[]>([]);
  const [unit, setUnit] = useState('');
  useEffect(() => {
    const active = activeDepartments(getCurrentClinicId());
    setUnits(active);
    setUnit(defaultDepartmentId(active));
  }, []);

  // A registration being typed is kept as a draft on this device until it is saved (lib/drafts).
  const draft = useDraft({
    form: 'new-patient',
    id: 'new',
    value: { name, phone, email, sex, birth, village, parish, subCounty, district },
    isEmpty: (v) => ![v.name, v.phone, v.email, v.sex, v.village, v.parish, v.subCounty, v.district].some((x) => String(x ?? '').trim())
      && JSON.stringify(v.birth) === JSON.stringify(emptyBirthDate()),
    label: 'New patient registration',
    path: '/patients/register',
    onRestore: (v) => {
      setName(v.name); setPhone(v.phone); setEmail(v.email); setSex(v.sex); setBirth(v.birth);
      setVillage(v.village); setParish(v.parish); setSubCounty(v.subCounty); setDistrict(v.district);
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (queueNow && units.length > 0 && !unit) {
      alert('Choose the unit the patient is here for, or untick "Add to today\'s waiting queue"');
      return;
    }
    setLoading(true);

    try {
      const clinicId = getCurrentClinicId() || 'default-clinic';
      const registered = await createPatientOffline({
        name,
        phone,
        email: email.trim() || undefined,
        clinicId,
        sex: sex || undefined,
        ...(() => {
          const { dateOfBirth, dateOfBirthEstimated } = birthDatePayload(birth);
          return dateOfBirth ? { dateOfBirth, dateOfBirthEstimated } : {};
        })(),
        village: village || undefined,
        parish: parish || undefined,
        subCounty: subCounty || undefined,
        district: district || undefined,
        consentGiven,
      });
      if (queueNow) {
        const user = getCurrentUser();
        const now = serverNow();
        await createAppointmentOffline({
          patientId: registered.id, doctorId: user.id || '', clinicId, date: now.toISOString(), time: formatTime(now), notes: 'Walk-in',
          patientName: registered.name, doctorName: user.name, checkedInAt: now.toISOString(), departmentId: units.length > 0 ? unit : null,
        });
      }

      setName('');
      setPhone('');
      setEmail('');
      setSex('');
      setBirth(emptyBirthDate());
      setVillage('');
      setParish('');
      setSubCounty('');
      setDistrict('');
      draft.discard();
      router.push(queueNow ? '/appointments' : '/patients');
    } catch (error: any) {
      alert(`Error saving patient: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <h1 className="text-3xl font-bold mb-2 text-slate-800 dark:text-slate-200">Register New Patient</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Works without internet - saved on this device and sent when you're back online</p>

      <Card className="p-6">
        <DraftNote className="mb-3" savedAt={draft.savedAt} restoredAt={draft.restoredAt} onDiscard={() => { draft.discard(); window.location.reload(); }} />
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="name">Patient Full Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. John Mukasa"
                required
              />
            </div>

            <div>
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 0756123456"
                required
              />
            </div>

            <div>
              <Label htmlFor="email">Email (optional)</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. john@example.com"
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                If provided, the patient is emailed a link to set up their password and sign in to the Patient Portal
                (sent once this record syncs). Please confirm the address with the patient.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="sex">Sex</Label>
                <Select
                  id="sex"
                  value={sex}
                  onChange={(e) => setSex(e.target.value as typeof sex)}
                >
                  <option value="">Not specified</option>
                  <option value="FEMALE">Female</option>
                  <option value="MALE">Male</option>
                  <option value="OTHER">Other</option>
                </Select>
              </div>

              <div>
                <BirthDateInput id="dateOfBirth" value={birth} onChange={setBirth} />
              </div>
            </div>

            <div className="border-t pt-4">
              <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Home Address (optional)</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="village">Village</Label>
                  <Input id="village" value={village} onChange={(e) => setVillage(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="parish">Parish</Label>
                  <Input id="parish" value={parish} onChange={(e) => setParish(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="subCounty">Sub-county</Label>
                  <Input id="subCounty" value={subCounty} onChange={(e) => setSubCounty(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="district">District</Label>
                  <Input id="district" value={district} onChange={(e) => setDistrict(e.target.value)} />
                </div>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={consentGiven} onChange={(e) => setConsentGiven(e.target.checked)} />
              Patient has given consent for their data to be recorded and shared for care coordination
            </label>

            <div className="flex flex-wrap items-end gap-3 rounded-md border border-slate-200 p-3 dark:border-slate-800">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={queueNow} onChange={(e) => setQueueNow(e.target.checked)} />
                Add to today&apos;s waiting queue
              </label>
              {queueNow && units.length > 0 && (
                <div className="min-w-[12rem]">
                  <Label htmlFor="queue-unit" className="text-xs">Unit</Label>
                  <Select id="queue-unit" className="mt-1" value={unit} onChange={(e) => setUnit(e.target.value)}>
                    <option value="">Choose the unit</option>
                    {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </Select>
                </div>
              )}
              <p className="w-full text-xs text-slate-500 dark:text-slate-400">Untick when registering a patient who is not here now, for example to book them for another day.</p>
            </div>

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Saving...' : 'Register Patient (Offline Ready)'}
          </Button>
        </form>
      </Card>
    </>
  );
}
