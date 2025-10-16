'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';

export default function RecordConsultation() {
  const searchParams = useSearchParams();
  const appointmentId = searchParams.get('appointmentId');
  
  const [appointment, setAppointment] = useState<any>(null);
  const [diagnosis, setDiagnosis] = useState('');
  const [symptoms, setSymptoms] = useState('');
  const [prescriptions, setPrescriptions] = useState([
    { medication: '', dosage: '', frequency: '', duration: '' }
  ]);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (appointmentId) fetchAppointment();
  }, [appointmentId]);

  const fetchAppointment = async () => {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/appointments/${user.clinicId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await response.json();
    const apt = data.appointments.find((a: any) => a.id === appointmentId);
    setAppointment(apt);
  };

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

    const token = localStorage.getItem('token');

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/consultations`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          appointmentId,
          patientId: appointment.patientId,
          diagnosis,
          symptoms,
          prescriptions: prescriptions.filter(p => p.medication),
          amount: amount ? parseFloat(amount) : null
        })
      });

      const data = await response.json();
      if (data.success) {
        alert('Consultation recorded!');
        window.location.href = '/appointments';
      }
    } catch (error) {
      alert('Error recording consultation');
    } finally {
      setLoading(false);
    }
  };

  if (!appointment) return <div className="p-8">Loading...</div>;

  return (
    <div className="min-h-screen p-8 bg-slate-50">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Record Consultation</h1>
        <p className="text-muted-foreground mb-6">Patient: {appointment.patient.name}</p>

        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <Label htmlFor="symptoms">Symptoms</Label>
              <Input 
                id="symptoms" 
                value={symptoms}
                onChange={(e) => setSymptoms(e.target.value)}
                placeholder="Fever, headache..."
                required
              />
            </div>

            <div>
              <Label htmlFor="diagnosis">Diagnosis</Label>
              <Input 
                id="diagnosis" 
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                placeholder="Malaria, Common cold..."
                required
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <Label>Prescriptions</Label>
                <Button type="button" size="sm" onClick={addPrescription}>+ Add</Button>
              </div>
              
              {prescriptions.map((rx, index) => (
                <div key={index} className="grid grid-cols-4 gap-2 mb-2">
                  <Input 
                    placeholder="Medication"
                    value={rx.medication}
                    onChange={(e) => updatePrescription(index, 'medication', e.target.value)}
                  />
                  <Input 
                    placeholder="Dosage"
                    value={rx.dosage}
                    onChange={(e) => updatePrescription(index, 'dosage', e.target.value)}
                  />
                  <Input 
                    placeholder="Frequency"
                    value={rx.frequency}
                    onChange={(e) => updatePrescription(index, 'frequency', e.target.value)}
                  />
                  <Input 
                    placeholder="Duration"
                    value={rx.duration}
                    onChange={(e) => updatePrescription(index, 'duration', e.target.value)}
                  />
                </div>
              ))}
            </div>

            <div>
              <Label htmlFor="amount">Consultation Fee (UGX)</Label>
              <Input 
                id="amount" 
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="50000"
              />
            </div>

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Recording...' : 'Record Consultation'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}