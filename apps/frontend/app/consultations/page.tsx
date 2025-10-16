'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';

export default function ConsultationsPage() {
  const [consultations, setConsultations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchConsultations();
  }, []);

  const fetchConsultations = async () => {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    try {
      const patientsRes = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/patients/${user.clinicId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const patientsData = await patientsRes.json();
      
      if (patientsData.success && patientsData.patients.length > 0) {
        const allConsultations = [];
        for (const patient of patientsData.patients) {
          const consultRes = await fetch(
            `${process.env.NEXT_PUBLIC_API_URL}/consultations/patient/${patient.id}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          const consultData = await consultRes.json();
          if (consultData.success) {
            allConsultations.push(...consultData.consultations.map((c: any) => ({
              ...c,
              patientName: patient.name
            })));
          }
        }
        setConsultations(allConsultations);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-8 bg-slate-50">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Consultations</h1>

        {loading ? (
          <p>Loading...</p>
        ) : consultations.length === 0 ? (
          <p>No consultations found</p>
        ) : (
          <div className="space-y-4">
            {consultations.map((consult: any) => (
              <Card key={consult.id} className="p-6">
                <div className="mb-4">
                  <h3 className="font-bold text-lg">{consult.patientName} - {consult.diagnosis}</h3>
                  <p className="text-sm text-muted-foreground">
                    {new Date(consult.createdAt).toLocaleDateString()}
                  </p>
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