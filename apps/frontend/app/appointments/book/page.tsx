'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import {
  listLocalPatients,
  createAppointmentOffline,
  getCurrentUser,
  getCurrentClinicId,
  LocalPatient,
} from '@/lib/local-first';

export default function BookAppointment() {
  const router = useRouter();
  const [patients, setPatients] = useState<LocalPatient[]>([]);
  const [patientId, setPatientId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const clinicId = getCurrentClinicId();
    if (clinicId) {
      listLocalPatients(clinicId).then(setPatients).catch(console.error);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const user = getCurrentUser();
      const clinicId = user.clinicId || 'default-clinic';
      const doctorId = user.id || 'default-doctor';
      const selectedPatient = patients.find((p) => p.id === patientId);

      await createAppointmentOffline({
        patientId,
        doctorId,
        clinicId,
        date,
        time,
        notes,
        patientName: selectedPatient?.name,
        doctorName: user.name || 'Staff Clinician',
      });

      router.push('/appointments');
    } catch (error: any) {
      alert(`Error booking appointment: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-8 bg-slate-50">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-2 text-slate-800">Book Appointment</h1>
        <p className="text-sm text-slate-500 mb-6">Works offline with background sync</p>

        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Patient</Label>
              <select
                className="w-full p-2.5 border border-slate-300 rounded-md bg-white text-slate-800"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                required
              >
                <option value="">Select patient from local registry</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.phone})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="date">Date</Label>
              <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>

            <div>
              <Label htmlFor="time">Time</Label>
              <Input id="time" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
            </div>

            <div>
              <Label htmlFor="notes">Notes / Reason for Visit</Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Fever, routine antenatal checkup"
              />
            </div>

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Booking...' : 'Book Appointment (Offline Ready)'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}