'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

export function PatientSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const search = async (q: string) => {
    setQuery(q);
    if (q.length < 2) {
      setResults([]);
      return;
    }

    setSearching(true);
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/search/patients?q=${q}&clinicId=${user.clinicId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const data = await response.json();
      if (data.success) setResults(data.patients);
    } catch (error) {
      console.error(error);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="relative">
      <Input
        placeholder="Search patients by name or phone..."
        value={query}
        onChange={(e) => search(e.target.value)}
      />
      
      {query.length >= 2 && (
        <div className="absolute top-12 left-0 right-0 bg-white shadow-lg rounded-lg max-h-96 overflow-y-auto z-10">
          {searching ? (
            <div className="p-4">Searching...</div>
          ) : results.length > 0 ? (
            results.map((patient: any) => (
              <Card key={patient.id} className="p-3 m-2 hover:bg-slate-50 cursor-pointer">
                <h4 className="font-semibold">{patient.name}</h4>
                <p className="text-sm text-muted-foreground">{patient.phone}</p>
              </Card>
            ))
          ) : (
            <div className="p-4">No patients found</div>
          )}
        </div>
      )}
    </div>
  );
}