'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';

export default function BookAppointment() {
  const [patients, setPatients] = useState([]);
  const [patientId, setPatientId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchPatients();
  }, []);

  const fetchPatients = async () => {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patients/${user.clinicId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json();
    if (data.success) setPatients(data.patients);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/appointments`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          patientId, 
          doctorId: user.id, 
          clinicId: user.clinicId, 
          date, 
          time, 
          notes 
        })
      });

      const data = await response.json();
      if (data.success) {
        alert('Appointment booked!');
        setPatientId(''); setDate(''); setTime(''); setNotes('');
      }
    } catch (error) {
      alert('Error booking appointment');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-8 bg-slate-50">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Book Appointment</h1>
        
        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Patient</Label>
              <select 
                className="w-full p-2 border rounded" 
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                required
              >
                <option value="">Select patient</option>
                {patients.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name} - {p.phone}</option>
                ))}
              </select>
            </div>
            
            <div>
              <Label htmlFor="date">Date</Label>
              <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>

            <div>
              <Label htmlFor="time">Time</Label>
              <Input id="time" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
            </div>

            <div>
              <Label htmlFor="notes">Notes</Label>
              <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Routine checkup" />
            </div>

            <Button type="submit" disabled={loading}>
              {loading ? 'Booking...' : 'Book Appointment'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}