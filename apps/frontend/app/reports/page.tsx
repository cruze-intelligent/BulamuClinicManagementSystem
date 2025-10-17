'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function ReportsPage() {
  const [report, setReport] = useState<any>(null);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(false);

  const fetchReport = async () => {
    setLoading(true);
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/reports/monthly/${user.clinicId}?month=${month}&year=${year}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const data = await response.json();
      if (data.success) setReport(data.report);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-8 bg-slate-50">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Reports & Analytics 📊</h1>

        <Card className="p-6 mb-6">
          <div className="flex gap-4 items-end">
            <div>
              <label className="text-sm font-medium">Month</label>
              <select 
                className="w-full p-2 border rounded mt-1"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
              >
                {[...Array(12)].map((_, i) => (
                  <option key={i} value={i + 1}>{new Date(0, i).toLocaleString('default', { month: 'long' })}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Year</label>
              <input 
                type="number" 
                className="w-full p-2 border rounded mt-1"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              />
            </div>
            <Button onClick={fetchReport} disabled={loading}>
              {loading ? 'Loading...' : 'Generate Report'}
            </Button>
          </div>
        </Card>

        {report && (
          <>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <Card className="p-6">
                <h3 className="text-sm text-muted-foreground">New Patients</h3>
                <p className="text-3xl font-bold">{report.totalPatients}</p>
              </Card>
              <Card className="p-6">
                <h3 className="text-sm text-muted-foreground">Appointments</h3>
                <p className="text-3xl font-bold">{report.totalAppointments}</p>
              </Card>
              <Card className="p-6">
                <h3 className="text-sm text-muted-foreground">Consultations</h3>
                <p className="text-3xl font-bold">{report.totalConsultations}</p>
              </Card>
              <Card className="p-6">
                <h3 className="text-sm text-muted-foreground">Revenue</h3>
                <p className="text-3xl font-bold">UGX {report.revenue.toLocaleString()}</p>
              </Card>
            </div>

            <Card className="p-6">
              <h2 className="text-xl font-bold mb-4">Top 5 Diagnoses</h2>
              <div className="space-y-2">
                {report.topDiagnoses.map((item: any, index: number) => (
                  <div key={index} className="flex justify-between items-center p-3 bg-slate-50 rounded">
                    <span className="font-medium">{item.diagnosis}</span>
                    <span className="text-sm text-muted-foreground">{item._count.diagnosis} cases</span>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}