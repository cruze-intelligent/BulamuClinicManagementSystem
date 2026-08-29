'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  listLocalLabTests,
  createLabTestOffline,
  listLocalPatients,
  cacheLabTests,
  getCurrentClinicId,
  getCurrentUser,
  subscribeToLocalChanges,
  LocalLabTest,
  LocalPatient,
} from '@/lib/local-first';

export default function LabTestsPage() {
  const [tests, setTests] = useState<LocalLabTest[]>([]);
  const [patients, setPatients] = useState<LocalPatient[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    patientId: '',
    testName: '',
  });
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    const clinicId = getCurrentClinicId();
    if (clinicId) {
      const patientList = await listLocalPatients(clinicId);
      setPatients(patientList);
    }

    const localTests = await listLocalLabTests();
    setTests(localTests);
    setLoading(false);

    if (navigator.onLine && clinicId) {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patients/${clinicId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.success && Array.isArray(data.patients)) {
          const remoteTests: any[] = [];
          for (const p of data.patients) {
            const labRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/lab/patient/${p.id}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const labData = await labRes.json();
            if (labData.success && Array.isArray(labData.tests)) {
              remoteTests.push(...labData.tests.map((t: any) => ({ ...t, patient: { name: p.name, phone: p.phone } })));
            }
          }
          await cacheLabTests(remoteTests);
          const updated = await listLocalLabTests();
          setTests(updated);
        }
      } catch (err) {
        console.warn('Lab tests fetch failed, using local store:', err);
      }
    }
  };

  useEffect(() => {
    loadData();
    const unsubscribe = subscribeToLocalChanges(loadData);
    return () => unsubscribe();
  }, []);

  const orderTest = async (e: React.FormEvent) => {
    e.preventDefault();
    const user = getCurrentUser();
    const clinicId = user.clinicId || 'default-clinic';
    const selectedPatient = patients.find((p) => p.id === formData.patientId);

    try {
      await createLabTestOffline({
        patientId: formData.patientId,
        clinicId,
        testName: formData.testName,
        results: '',
        orderedBy: user.name || 'Clinical Staff',
        patientName: selectedPatient?.name,
      });

      setShowForm(false);
      setFormData({ patientId: '', testName: '' });
      loadData();
    } catch (error: any) {
      alert(`Error ordering lab test: ${error.message}`);
    }
  };

  return (
    <div className="min-h-screen p-8 bg-slate-50">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-800">Laboratory Diagnostic Tests 🔬</h1>
            <p className="text-sm text-slate-500 mt-1">Local-First Diagnostic Orders & Results</p>
          </div>
          <Button onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : '+ Order Lab Test'}
          </Button>
        </div>

        {showForm && (
          <Card className="p-6 mb-6">
            <form onSubmit={orderTest} className="space-y-4">
              <div>
                <Label>Patient</Label>
                <select
                  className="w-full p-2.5 border border-slate-300 rounded-md bg-white text-slate-800"
                  value={formData.patientId}
                  onChange={(e) => setFormData({ ...formData, patientId: e.target.value })}
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
                <Label htmlFor="testName">Diagnostic Test Name</Label>
                <Input
                  id="testName"
                  value={formData.testName}
                  onChange={(e) => setFormData({ ...formData, testName: e.target.value })}
                  placeholder="e.g. Malaria RDT, Complete Blood Count, Urinalysis"
                  required
                />
              </div>

              <Button type="submit" className="w-full">
                Order Test (Offline Ready)
              </Button>
            </form>
          </Card>
        )}

        {loading ? (
          <p className="text-slate-500">Loading diagnostic tests...</p>
        ) : tests.length === 0 ? (
          <Card className="p-8 text-center text-slate-500">
            No lab tests ordered yet. Click above to order a lab test (works offline).
          </Card>
        ) : (
          <div className="space-y-3">
            {tests.map((test) => (
              <Card key={test.id} className="p-4">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-slate-800">{test.patient?.name || 'Patient'}</h3>
                      {test.syncStatus === 'pending' && (
                        <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-medium">
                          Pending Sync
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-blue-700 mt-1">{test.testName}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Ordered by {test.orderedBy} • {new Date(test.createdAt).toLocaleDateString()}
                    </p>
                    {test.results && (
                      <div className="text-sm mt-2 bg-slate-100 p-2.5 rounded-md text-slate-800">
                        <strong className="font-medium">Result:</strong> {test.results}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 items-center">
                    <span
                      className={`text-xs px-2.5 py-1 rounded font-medium ${
                        test.status === 'COMPLETED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {test.status}
                    </span>
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