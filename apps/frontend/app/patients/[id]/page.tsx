'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function PatientHistoryPage() {
  const params = useParams();
  const patientId = params.id as string;
  
  const [patient, setPatient] = useState<any>(null);
  const [consultations, setConsultations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (patientId) {
      fetchPatientHistory();
    }
  }, [patientId]);

  const fetchPatientHistory = async () => {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    try {
      // Get patient details
      const patientsRes = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/patients/${user.clinicId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const patientsData = await patientsRes.json();
      const foundPatient = patientsData.patients.find((p: any) => p.id === patientId);
      setPatient(foundPatient);

      // Get consultations
      const consultRes = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/consultations/patient/${patientId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const consultData = await consultRes.json();
      if (consultData.success) setConsultations(consultData.consultations);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="p-8">Loading...</div>;
  if (!patient) return <div className="p-8">Patient not found</div>;

  return (
    <div className="min-h-screen p-8 bg-slate-50">
      <div className="max-w-4xl mx-auto">
        <Link href="/patients">
          <Button variant="outline" className="mb-4">← Back to Patients</Button>
        </Link>

        <Card className="p-6 mb-6">
          <h1 className="text-3xl font-bold mb-2">{patient.name}</h1>
          <p className="text-muted-foreground">{patient.phone}</p>
          <p className="text-sm mt-2">
            Patient since {new Date(patient.createdAt).toLocaleDateString()}
          </p>
        </Card>

        <h2 className="text-xl font-bold mb-4">Medical History ({consultations.length} visits)</h2>

        {consultations.length === 0 ? (
          <p>No consultation history</p>
        ) : (
          <div className="space-y-4">
            {consultations.map((consult: any) => (
              <Card key={consult.id} className="p-6">
                <div className="mb-4">
                  <div className="flex justify-between items-start">
                    <h3 className="font-bold text-lg">{consult.diagnosis}</h3>
                    <p className="text-sm text-muted-foreground">
                      {new Date(consult.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="mb-4">
                  <p className="text-sm"><strong>Symptoms:</strong> {consult.symptoms}</p>
                </div>

                {consult.prescriptions.length > 0 && (
                  <div className="mb-4">
                    <h4 className="font-semibold mb-2">Prescriptions:</h4>
                    {consult.prescriptions.map((rx: any) => (
                      <div key={rx.id} className="bg-slate-50 p-3 rounded mb-2">
                        <p className="font-medium">{rx.medication}</p>
                        <p className="text-sm text-muted-foreground">
                          {rx.dosage} • {rx.frequency} • {rx.duration}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {consult.invoice && (
                  <div className="border-t pt-4">
                    <p className="text-sm">
                      <strong>Fee:</strong> UGX {consult.invoice.amount.toLocaleString()}
                      <span className={`ml-2 px-2 py-1 rounded text-xs ${
                        consult.invoice.status === 'PAID' ? 'bg-green-100' : 'bg-yellow-100'
                      }`}>
                        {consult.invoice.status}
                      </span>
                    </p>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}