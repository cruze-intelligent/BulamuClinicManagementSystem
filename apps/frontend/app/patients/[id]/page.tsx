'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Link from 'next/link';
import { useAuth } from '@/lib/useAuth';
import { calculateAgeYears } from '@/lib/age';
import { validateReproductiveHealthForm } from '@/lib/reproductive-health-validation';

export default function PatientHistoryPage() {
  const params = useParams();
  const patientId = params.id as string;
  const { hasRole } = useAuth();

  const [patient, setPatient] = useState<any>(null);
  const [consultations, setConsultations] = useState([]);
  const [reproductiveHealthRecords, setReproductiveHealthRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRhForm, setShowRhForm] = useState(false);
  const [rhSaving, setRhSaving] = useState(false);
  const [rhForm, setRhForm] = useState({
    lastMenstrualPeriodDate: '',
    cycleLengthDays: '',
    flowDurationDays: '',
    familyPlanningMethod: 'NONE',
    pregnancyStatus: 'UNKNOWN',
    gravida: '',
    para: '',
    notes: '',
  });

  useEffect(() => {
    if (patientId) {
      fetchPatientHistory();
    }
  }, [patientId]);

  const fetchPatientHistory = async () => {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    try {
      const patientsRes = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/patients/${user.clinicId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const patientsData = await patientsRes.json();
      const foundPatient = patientsData.patients.find((p: any) => p.id === patientId);
      setPatient(foundPatient);

      const consultRes = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/consultations/patient/${patientId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const consultData = await consultRes.json();
      if (consultData.success) setConsultations(consultData.consultations);

      if (foundPatient?.sex === 'FEMALE') {
        const rhRes = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/patients/${patientId}/reproductive-health`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const rhData = await rhRes.json();
        if (rhData.success) setReproductiveHealthRecords(rhData.records);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const [rhErrors, setRhErrors] = useState<Record<string, string>>({});

  const handleAddReproductiveHealth = async (e: React.FormEvent) => {
    e.preventDefault();

    const validation = validateReproductiveHealthForm({
      cycleLengthDays: rhForm.cycleLengthDays,
      flowDurationDays: rhForm.flowDurationDays,
      gravida: rhForm.gravida,
      para: rhForm.para,
    });
    setRhErrors(validation.errors as Record<string, string>);
    if (!validation.valid) return;

    setRhSaving(true);
    const token = localStorage.getItem('token');

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/patients/${patientId}/reproductive-health`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            lastMenstrualPeriodDate: rhForm.lastMenstrualPeriodDate || undefined,
            cycleLengthDays: rhForm.cycleLengthDays ? Number(rhForm.cycleLengthDays) : undefined,
            flowDurationDays: rhForm.flowDurationDays ? Number(rhForm.flowDurationDays) : undefined,
            familyPlanningMethod: rhForm.familyPlanningMethod,
            pregnancyStatus: rhForm.pregnancyStatus,
            gravida: rhForm.gravida ? Number(rhForm.gravida) : undefined,
            para: rhForm.para ? Number(rhForm.para) : undefined,
            notes: rhForm.notes || undefined,
          }),
        }
      );
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to save record');

      setReproductiveHealthRecords((prev) => [data.record, ...prev]);
      setShowRhForm(false);
      setRhForm({
        lastMenstrualPeriodDate: '',
        cycleLengthDays: '',
        flowDurationDays: '',
        familyPlanningMethod: 'NONE',
        pregnancyStatus: 'UNKNOWN',
        gravida: '',
        para: '',
        notes: '',
      });
    } catch (error: any) {
      alert(`Error saving record: ${error.message}`);
    } finally {
      setRhSaving(false);
    }
  };

  if (loading) return <div className="p-8">Loading...</div>;
  if (!patient) return <div className="p-8">Patient not found</div>;

  const canEditClinicalData = hasRole('NURSE', 'DOCTOR', 'ADMIN');

  return (
    <div className="min-h-screen p-8 bg-slate-50">
      <div className="max-w-4xl mx-auto">
        <Link href="/patients">
          <Button variant="outline" className="mb-4">← Back to Patients</Button>
        </Link>

        <Card className="p-6 mb-6">
          <h1 className="text-3xl font-bold mb-2">{patient.name}</h1>
          <p className="text-muted-foreground">{patient.phone}</p>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm mt-3 text-slate-600">
            {patient.sex && <span>Sex: {patient.sex}</span>}
            {patient.dateOfBirth && <span>Age: {calculateAgeYears(patient.dateOfBirth)} years</span>}
            {(patient.village || patient.parish || patient.subCounty || patient.district) && (
              <span>
                Address: {[patient.village, patient.parish, patient.subCounty, patient.district].filter(Boolean).join(', ')}
              </span>
            )}
          </div>
          <p className="text-sm mt-2 text-slate-500">
            Patient since {new Date(patient.createdAt).toLocaleDateString()}
          </p>
        </Card>

        {patient.sex === 'FEMALE' && (
          <Card className="p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Reproductive Health</h2>
              {canEditClinicalData && (
                <Button size="sm" onClick={() => setShowRhForm((v) => !v)}>
                  {showRhForm ? 'Cancel' : 'Add Record'}
                </Button>
              )}
            </div>

            {showRhForm && (
              <form onSubmit={handleAddReproductiveHealth} className="space-y-3 mb-6 border-b pb-6">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="lmp">Last Menstrual Period</Label>
                    <Input
                      id="lmp"
                      type="date"
                      value={rhForm.lastMenstrualPeriodDate}
                      onChange={(e) => setRhForm((f) => ({ ...f, lastMenstrualPeriodDate: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="cycleLength">Cycle Length (days)</Label>
                    <Input
                      id="cycleLength"
                      type="number"
                      min={1}
                      value={rhForm.cycleLengthDays}
                      onChange={(e) => setRhForm((f) => ({ ...f, cycleLengthDays: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="flowDuration">Flow Duration (days)</Label>
                    <Input
                      id="flowDuration"
                      type="number"
                      min={1}
                      value={rhForm.flowDurationDays}
                      onChange={(e) => setRhForm((f) => ({ ...f, flowDurationDays: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="familyPlanningMethod">Family Planning Method</Label>
                    <select
                      id="familyPlanningMethod"
                      value={rhForm.familyPlanningMethod}
                      onChange={(e) => setRhForm((f) => ({ ...f, familyPlanningMethod: e.target.value }))}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                    >
                      {['NONE', 'CONDOM', 'PILL', 'INJECTABLE', 'IMPLANT', 'IUD', 'NATURAL', 'PERMANENT', 'OTHER'].map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="pregnancyStatus">Pregnancy Status</Label>
                    <select
                      id="pregnancyStatus"
                      value={rhForm.pregnancyStatus}
                      onChange={(e) => setRhForm((f) => ({ ...f, pregnancyStatus: e.target.value }))}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                    >
                      {['UNKNOWN', 'NOT_PREGNANT', 'PREGNANT', 'POSTPARTUM'].map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="gravida">Gravida</Label>
                      <Input
                        id="gravida"
                        type="number"
                        min={0}
                        value={rhForm.gravida}
                        onChange={(e) => setRhForm((f) => ({ ...f, gravida: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label htmlFor="para">Para</Label>
                      <Input
                        id="para"
                        type="number"
                        min={0}
                        value={rhForm.para}
                        onChange={(e) => setRhForm((f) => ({ ...f, para: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>
                <div>
                  <Label htmlFor="notes">Notes</Label>
                  <Input
                    id="notes"
                    value={rhForm.notes}
                    onChange={(e) => setRhForm((f) => ({ ...f, notes: e.target.value }))}
                  />
                </div>
                <Button type="submit" disabled={rhSaving}>
                  {rhSaving ? 'Saving...' : 'Save Record'}
                </Button>
              </form>
            )}

            {reproductiveHealthRecords.length === 0 ? (
              <p className="text-sm text-muted-foreground">No reproductive health records yet</p>
            ) : (
              <div className="space-y-3">
                {reproductiveHealthRecords.map((record) => (
                  <div key={record.id} className="bg-slate-50 p-3 rounded text-sm">
                    <div className="flex justify-between">
                      <span className="font-medium">
                        {record.pregnancyStatus} · {record.familyPlanningMethod}
                      </span>
                      <span className="text-muted-foreground">
                        {new Date(record.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    {record.lastMenstrualPeriodDate && (
                      <p className="text-muted-foreground mt-1">
                        LMP: {new Date(record.lastMenstrualPeriodDate).toLocaleDateString()}
                        {record.cycleLengthDays ? ` · Cycle: ${record.cycleLengthDays}d` : ''}
                        {record.flowDurationDays ? ` · Flow: ${record.flowDurationDays}d` : ''}
                      </p>
                    )}
                    {(record.gravida != null || record.para != null) && (
                      <p className="text-muted-foreground">
                        {record.gravida != null ? `Gravida: ${record.gravida} ` : ''}
                        {record.para != null ? `Para: ${record.para}` : ''}
                      </p>
                    )}
                    {record.notes && <p className="mt-1">{record.notes}</p>}
                    {record.recordedBy?.name && (
                      <p className="text-xs text-muted-foreground mt-1">Recorded by {record.recordedBy.name}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

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
