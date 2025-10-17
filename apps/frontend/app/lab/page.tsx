'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function LabTestsPage() {
  const [tests, setTests] = useState([]);
  const [patients, setPatients] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    patientId: '',
    testName: '',
    orderedBy: ''
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTests();
    fetchPatients();
  }, []);

  const fetchPatients = async () => {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/patients/${user.clinicId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await response.json();
    if (data.success) setPatients(data.patients);
  };

  const fetchTests = async () => {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    try {
      // Get all patients' tests (simplified - in production, get clinic-wide)
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/patients/${user.clinicId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json();
      
      if (data.success && data.patients.length > 0) {
        const allTests = [];
        for (const patient of data.patients) {
          const testRes = await fetch(
            `${process.env.NEXT_PUBLIC_API_URL}/lab/patient/${patient.id}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          const testData = await testRes.json();
          if (testData.success) {
            allTests.push(...testData.tests.map((t: any) => ({
              ...t,
              patientName: patient.name
            })));
          }
        }
        setTests(allTests);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const orderTest = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/lab`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          ...formData,
          orderedBy: user.name
        })
      });

      alert('Lab test ordered!');
      setShowForm(false);
      setFormData({ patientId: '', testName: '', orderedBy: '' });
      fetchTests();
    } catch (error) {
      alert('Error ordering test');
    }
  };

  const updateTest = async (id: string, results: string) => {
    const token = localStorage.getItem('token');

    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/lab/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ results, status: 'COMPLETED' })
      });

      fetchTests();
    } catch (error) {
      alert('Error updating test');
    }
  };

  return (
    <div className="min-h-screen p-8 bg-slate-50">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Lab Tests 🔬</h1>
          <Button onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : '+ Order Test'}
          </Button>
        </div>

        {showForm && (
          <Card className="p-6 mb-6">
            <form onSubmit={orderTest} className="space-y-4">
              <div>
                <Label>Patient</Label>
                <select
                  className="w-full p-2 border rounded"
                  value={formData.patientId}
                  onChange={(e) => setFormData({ ...formData, patientId: e.target.value })}
                  required
                >
                  <option value="">Select patient</option>
                  {patients.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <Label htmlFor="testName">Test Name</Label>
                <Input
                  id="testName"
                  value={formData.testName}
                  onChange={(e) => setFormData({ ...formData, testName: e.target.value })}
                  placeholder="Blood Test, Malaria Test, etc."
                  required
                />
              </div>

              <Button type="submit" className="w-full">Order Test</Button>
            </form>
          </Card>
        )}

        {loading ? (
          <p>Loading...</p>
        ) : (
          <div className="space-y-3">
            {tests.map((test: any) => (
              <Card key={test.id} className="p-4">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="font-semibold">{test.patientName}</h3>
                    <p className="text-sm font-medium text-blue-600">{test.testName}</p>
                    <p className="text-xs text-muted-foreground">
                      Ordered by {test.orderedBy} • {new Date(test.createdAt).toLocaleDateString()}
                    </p>
                    {test.results && (
                      <p className="text-sm mt-2 bg-slate-50 p-2 rounded">{test.results}</p>
                    )}
                  </div>
                  <div className="flex gap-2 items-center">
                    {test.status === 'PENDING' && (
                      <Button
                        size="sm"
                        onClick={() => {
                          const results = prompt('Enter test results:');
                          if (results) updateTest(test.id, results);
                        }}
                      >
                        Add Results
                      </Button>
                    )}
                    <span className={`text-xs px-2 py-1 rounded ${
                      test.status === 'COMPLETED' ? 'bg-green-100' : 'bg-yellow-100'
                    }`}>
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