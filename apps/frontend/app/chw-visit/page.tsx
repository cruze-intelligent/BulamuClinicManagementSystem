'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  createPatientOffline,
  createAppointmentOffline,
  createConsultationOffline,
  getCurrentClinicId,
  getCurrentUser,
} from '@/lib/local-first';
import { buildChwVisitSummary } from '@/lib/chw-visit';

const SYMPTOM_OPTIONS = [
  'Fever',
  'Cough',
  'Diarrhea',
  'Vomiting',
  'Difficulty breathing',
  'Severe malnutrition signs',
];

const DANGER_SIGNS = ['Convulsions', 'Unable to drink/breastfeed', 'Unconscious or very weak'];

export default function ChwVisitPage() {
  const router = useRouter();
  const [patientName, setPatientName] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [dangerSigns, setDangerSigns] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const toggle = (list: string[], setList: (v: string[]) => void, value: string) => {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const clinicId = getCurrentClinicId() || 'default-clinic';
      const currentUser = getCurrentUser();

      const patient = await createPatientOffline({ name: patientName, phone: patientPhone, clinicId });

      const appointment = await createAppointmentOffline({
        patientId: patient.id,
        doctorId: currentUser.id || 'unknown',
        clinicId,
        date: new Date().toISOString().slice(0, 10),
        time: new Date().toTimeString().slice(0, 5),
        patientName: patient.name,
        doctorName: currentUser.name,
      });

      const summary = buildChwVisitSummary(symptoms, dangerSigns);

      await createConsultationOffline({
        appointmentId: appointment.id,
        patientId: patient.id,
        clinicId,
        diagnoses: [{ description: summary.diagnosis, type: 'PRIMARY', certainty: 'CONFIRMED' }],
        symptoms: summary.symptomsText,
        serviceTags: ['COMMUNITY_HOUSEHOLD_VISIT'],
        prescriptions: [],
        patientName: patient.name,
      });

      if (summary.hasDangerSign) {
        alert(
          `Danger sign(s) recorded for ${patient.name}. Please refer this patient to a higher-level facility as soon as possible.`
        );
      }

      setPatientName('');
      setPatientPhone('');
      setSymptoms([]);
      setDangerSigns([]);
      setNotes('');
      router.push('/patients');
    } catch (error: any) {
      alert(`Error saving visit: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen p-8 bg-slate-50 dark:bg-slate-950">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-2 text-slate-800 dark:text-slate-200">Household Visit</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          Quick triage for community outreach - works fully offline, syncs when connected
        </p>

        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <Label htmlFor="patientName">Patient Name</Label>
              <Input id="patientName" required value={patientName} onChange={(e) => setPatientName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="patientPhone">Phone Number</Label>
              <Input id="patientPhone" required value={patientPhone} onChange={(e) => setPatientPhone(e.target.value)} />
            </div>

            <div>
              <p className="text-sm font-medium mb-2">Symptoms Observed</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {SYMPTOM_OPTIONS.map((symptom) => (
                  <label key={symptom} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={symptoms.includes(symptom)}
                      onChange={() => toggle(symptoms, setSymptoms, symptom)}
                    />
                    {symptom}
                  </label>
                ))}
              </div>
            </div>

            <div className="border border-red-200 bg-red-50 rounded-md p-3">
              <p className="text-sm font-medium mb-2 text-red-800">Danger Signs (flags for referral)</p>
              <div className="grid grid-cols-1 gap-2">
                {DANGER_SIGNS.map((sign) => (
                  <label key={sign} className="flex items-center gap-2 text-sm text-red-900">
                    <input
                      type="checkbox"
                      checked={dangerSigns.includes(sign)}
                      onChange={() => toggle(dangerSigns, setDangerSigns, sign)}
                    />
                    {sign}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <Label htmlFor="notes">Additional Notes</Label>
              <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <Button type="submit" disabled={saving} className="w-full">
              {saving ? 'Saving...' : 'Save Visit (Offline Ready)'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
