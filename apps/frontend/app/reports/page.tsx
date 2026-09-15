'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getCurrentClinicId } from '@/lib/local-first';
import { useAuth } from '@/lib/useAuth';

export default function ReportsPage() {
  const { hasRole } = useAuth();
  const [activeTab, setActiveTab] = useState<'overview' | 'hmis105'>('overview');
  const [report, setReport] = useState<any>(null);
  const [hmisReport, setHmisReport] = useState<any>(null);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(false);
  const [pushingDhis2, setPushingDhis2] = useState(false);

  const pushToDhis2 = async () => {
    setPushingDhis2(true);
    const token = localStorage.getItem('token');
    const clinicId = getCurrentClinicId();

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/reports/hmis-105/${clinicId}/push-dhis2?month=${month}&year=${year}`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json();
      if (data.success) {
        alert('Pushed to DHIS2 successfully.' + (data.unmappedFigures?.length ? ` ${data.unmappedFigures.length} figures have no dataElement mapping configured yet.` : ''));
      } else {
        alert(`DHIS2 push failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err) {
      alert('Could not reach the Bulamu API to push to DHIS2');
    } finally {
      setPushingDhis2(false);
    }
  };

  const fetchOverviewReport = async () => {
    setLoading(true);
    const token = localStorage.getItem('token');
    const clinicId = getCurrentClinicId();

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/reports/monthly/${clinicId}?month=${month}&year=${year}`,
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

  const fetchHmis105Report = async () => {
    setLoading(true);
    const token = localStorage.getItem('token');
    const clinicId = getCurrentClinicId();

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/reports/hmis-105/${clinicId}?month=${month}&year=${year}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const data = await response.json();
      if (data.success) setHmisReport(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const downloadFhirExport = async () => {
    const token = localStorage.getItem('token');
    const clinicId = getCurrentClinicId();

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/reports/fhir/patients/${clinicId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fhir-patients-bundle.json`;
      a.click();
    } catch (err) {
      alert('Error downloading FHIR Bundle');
    }
  };

  return (
    <div className="min-h-screen p-8 bg-slate-50">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-800">Reports & Surveillance 📊</h1>
            <p className="text-sm text-slate-500 mt-1">
              National Health Data Aggregation & Interoperability (HMIS 105 / FHIR)
            </p>
          </div>
          <Button variant="outline" onClick={downloadFhirExport}>
            📥 Export FHIR R4 Bundle
          </Button>
        </div>

        {/* Tab Selection */}
        <div className="flex gap-2 mb-6 border-b border-slate-200 pb-2">
          <Button
            variant={activeTab === 'overview' ? 'default' : 'ghost'}
            onClick={() => setActiveTab('overview')}
          >
            Facility Overview
          </Button>
          <Button
            variant={activeTab === 'hmis105' ? 'default' : 'ghost'}
            onClick={() => {
              setActiveTab('hmis105');
              fetchHmis105Report();
            }}
          >
            Uganda HMIS 105 Monthly Report
          </Button>
        </div>

        {/* Control Card */}
        <Card className="p-6 mb-6">
          <div className="flex gap-4 items-end">
            <div>
              <label className="text-sm font-medium text-slate-700">Reporting Month</label>
              <select
                className="w-full p-2 border border-slate-300 rounded mt-1 bg-white"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
              >
                {[...Array(12)].map((_, i) => (
                  <option key={i} value={i + 1}>
                    {new Date(0, i).toLocaleString('default', { month: 'long' })}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Year</label>
              <input
                type="number"
                className="w-full p-2 border border-slate-300 rounded mt-1 bg-white"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              />
            </div>
            <Button
              onClick={activeTab === 'overview' ? fetchOverviewReport : fetchHmis105Report}
              disabled={loading}
            >
              {loading ? 'Generating...' : 'Generate Report'}
            </Button>
          </div>
        </Card>

        {/* Overview Tab Content */}
        {activeTab === 'overview' && report && (
          <>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <Card className="p-6">
                <h3 className="text-sm text-slate-500 font-medium">New Patients Registered</h3>
                <p className="text-3xl font-bold text-slate-800 mt-2">{report.totalPatients}</p>
              </Card>
              <Card className="p-6">
                <h3 className="text-sm text-slate-500 font-medium">Appointments Scheduled</h3>
                <p className="text-3xl font-bold text-slate-800 mt-2">{report.totalAppointments}</p>
              </Card>
              <Card className="p-6">
                <h3 className="text-sm text-slate-500 font-medium">Clinical Encounters</h3>
                <p className="text-3xl font-bold text-slate-800 mt-2">{report.totalConsultations}</p>
              </Card>
              <Card className="p-6">
                <h3 className="text-sm text-slate-500 font-medium">Facility Revenue</h3>
                <p className="text-3xl font-bold text-emerald-600 mt-2">
                  UGX {report.revenue.toLocaleString()}
                </p>
              </Card>
            </div>

            <Card className="p-6">
              <h2 className="text-xl font-bold mb-4 text-slate-800">Top Diagnoses</h2>
              <div className="space-y-2">
                {report.topDiagnoses.map((item: any, index: number) => (
                  <div key={index} className="flex justify-between items-center p-3 bg-slate-50 rounded-md">
                    <span className="font-medium text-slate-800">{item.diagnosis}</span>
                    <span className="text-sm text-slate-500 font-semibold">{item._count.diagnosis} cases</span>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}

        {/* HMIS 105 Tab Content */}
        {activeTab === 'hmis105' && hmisReport && (
          <Card className="p-6">
            <div className="border-b pb-4 mb-6 flex justify-between items-start">
              <div>
                <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-full uppercase tracking-wider">
                  Ministry of Health Uganda Standard
                </span>
                <h2 className="text-2xl font-bold text-slate-800 mt-2">{hmisReport.reportTitle}</h2>
                <p className="text-sm text-slate-500">
                  Facility: {hmisReport.facilityName} | Period: {hmisReport.period}
                </p>
              </div>
              {hasRole('ADMIN', 'SUPER_ADMIN') && (
                <Button variant="outline" onClick={pushToDhis2} disabled={pushingDhis2}>
                  {pushingDhis2 ? 'Pushing...' : '🔄 Push to DHIS2'}
                </Button>
              )}
            </div>

            <div className="space-y-6">
              <div>
                <h3 className="font-semibold text-slate-800 mb-2">Section 1: Outpatient Attendance Summary</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 bg-slate-50 rounded-lg text-center">
                    <p className="text-xs text-slate-500">Total Outpatient Visits</p>
                    <p className="text-2xl font-bold text-slate-800">{hmisReport.section1_attendance.totalOutpatients}</p>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-lg text-center">
                    <p className="text-xs text-slate-500">New Attenders</p>
                    <p className="text-2xl font-bold text-slate-800">{hmisReport.section1_attendance.newAttenders}</p>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-lg text-center">
                    <p className="text-xs text-slate-500">Re-attenders</p>
                    <p className="text-2xl font-bold text-slate-800">{hmisReport.section1_attendance.reAttenders}</p>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-slate-800 mb-2">Section 2: Epidemic-Prone Disease Surveillance</h3>
                <div className="space-y-2">
                  {hmisReport.section2_epidemicSurveillance.map((item: any, idx: number) => (
                    <div key={idx} className="flex justify-between items-center p-3 border rounded-md">
                      <span className="text-sm font-medium text-slate-700">{item.condition}</span>
                      <span className="text-sm font-bold text-slate-900 bg-slate-100 px-3 py-1 rounded">
                        {item.cases} cases
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-slate-800 mb-2">Section 3: Essential Medicines Availability</h3>
                <div className="p-4 border rounded-lg bg-amber-50/50">
                  <p className="text-sm text-slate-700">
                    Tracked Medicines: <strong>{hmisReport.section3_essentialMedicines.totalTracked}</strong> |
                    Stock-Out Alerts: <strong className="text-rose-600">{hmisReport.section3_essentialMedicines.stockOutAlerts}</strong>
                  </p>
                  {hmisReport.section3_essentialMedicines.lowStockList?.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {hmisReport.section3_essentialMedicines.lowStockList.map((m: any, i: number) => (
                        <div key={i} className="text-xs text-rose-800">
                          ⚠️ {m.name}: {m.currentQuantity} remaining (Reorder level: {m.reorderLevel})
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-slate-800 mb-2">Section 4: Family Planning</h3>
                <p className="text-sm text-slate-600 mb-2">
                  Total records this period: <strong>{hmisReport.section4_familyPlanning.totalRecorded}</strong>
                </p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(hmisReport.section4_familyPlanning.byMethod).map(([method, count]: any) => (
                    <span key={method} className="text-xs bg-slate-100 px-2 py-1 rounded">{method}: {count}</span>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-slate-800 mb-2">Section 5: Maternal Health</h3>
                <p className="text-sm text-slate-600">
                  Pregnant clients: <strong>{hmisReport.section5_maternalHealth.pregnantClients}</strong> | Postpartum: <strong>{hmisReport.section5_maternalHealth.postpartumClients}</strong>
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-slate-800 mb-2">Section 6: Other Tracked Services</h3>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(hmisReport.section6_services.byTag).map(([tag, count]: any) => (
                    <span key={tag} className="text-xs bg-slate-100 px-2 py-1 rounded">{tag.replaceAll('_', ' ')}: {count}</span>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-slate-800 mb-2">Section 7: Referrals Out</h3>
                <p className="text-sm text-slate-600 mb-2">
                  Total referred: <strong>{hmisReport.section7_referrals.totalReferred}</strong>
                </p>
                {hmisReport.section7_referrals.referrals?.length > 0 && (
                  <div className="space-y-1">
                    {hmisReport.section7_referrals.referrals.map((r: any, i: number) => (
                      <div key={i} className="text-xs text-slate-600">
                        → {r.toFacility}: {r.reason} ({r.status})
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}