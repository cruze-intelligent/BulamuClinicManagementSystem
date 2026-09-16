'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import {
  createConsultationOffline,
  listLocalPatients,
  getCurrentClinicId,
} from '@/lib/local-first';

function RecordConsultationForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const appointmentId = searchParams.get('appointmentId') || `apt-${Date.now()}`;
  const queryPatientId = searchParams.get('patientId') || '';

  const [patientId, setPatientId] = useState(queryPatientId);
  const [patientName, setPatientName] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [symptoms, setSymptoms] = useState('');
  const [prescriptions, setPrescriptions] = useState([
    { medication: '', dosage: '', frequency: '', duration: '' },
  ]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const clinicId = getCurrentClinicId();
    if (clinicId && queryPatientId) {
      listLocalPatients(clinicId).then((patients) => {
        const found = patients.find((p) => p.id === queryPatientId);
        if (found) setPatientName(found.name);
      });
    }
  }, [queryPatientId]);

  const addPrescription = () => {
    setPrescriptions([...prescriptions, { medication: '', dosage: '', frequency: '', duration: '' }]);
  };

  const updatePrescription = (index: number, field: string, value: string) => {
    const updated = [...prescriptions];
    updated[index] = { ...updated[index], [field]: value };
    setPrescriptions(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const clinicId = getCurrentClinicId() || 'default-clinic';
      const validPrescriptions = prescriptions.filter((p) => p.medication.trim() !== '');

      await createConsultationOffline({
        appointmentId,
        patientId: patientId || 'walk-in-patient',
        clinicId,
        diagnosis,
        symptoms,
        prescriptions: validPrescriptions,
        patientName,
      });

      router.push('/consultations');
    } catch (error: any) {
      alert(`Error recording consultation: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-8 bg-slate-50 dark:bg-slate-950">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold mb-1 text-slate-800 dark:text-slate-200">Record Clinical Encounter</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          {patientName ? `Patient: ${patientName}` : 'Offline-first Clinical Decision & Triage Record'}
        </p>

        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <Label htmlFor="symptoms">Symptoms / Presenting Complaints</Label>
              <Input
                id="symptoms"
                value={symptoms}
                onChange={(e) => setSymptoms(e.target.value)}
                placeholder="e.g. High fever, chills, joint pain"
                required
              />
            </div>

            <div>
              <Label htmlFor="diagnosis">Primary Diagnosis</Label>
              <Input
                id="diagnosis"
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                placeholder="e.g. Confirmed Malaria (RDT+), Severe Acute Respiratory Infection"
                required
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <Label>Prescriptions / Therapeutics</Label>
                <Button type="button" size="sm" variant="outline" onClick={addPrescription}>
                  + Add Medication
                </Button>
              </div>

              {prescriptions.map((rx, index) => (
                <div key={index} className="grid grid-cols-4 gap-2 mb-2">
                  <Input
                    placeholder="Medication (e.g. Coartem)"
                    value={rx.medication}
                    onChange={(e) => updatePrescription(index, 'medication', e.target.value)}
                  />
                  <Input
                    placeholder="Dosage (e.g. 1 tab)"
                    value={rx.dosage}
                    onChange={(e) => updatePrescription(index, 'dosage', e.target.value)}
                  />
                  <Input
                    placeholder="Frequency (e.g. BD)"
                    value={rx.frequency}
                    onChange={(e) => updatePrescription(index, 'frequency', e.target.value)}
                  />
                  <Input
                    placeholder="Duration (e.g. 3 days)"
                    value={rx.duration}
                    onChange={(e) => updatePrescription(index, 'duration', e.target.value)}
                  />
                </div>
              ))}
            </div>

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Saving Record...' : 'Save Consultation (Offline Ready)'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

export default function RecordConsultation() {
  return (
    <Suspense fallback={<div className="p-8">Loading consultation form...</div>}>
      <RecordConsultationForm />
    </Suspense>
  );
}