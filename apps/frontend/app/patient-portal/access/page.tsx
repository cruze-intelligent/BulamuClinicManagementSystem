'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Building2, ShieldCheck } from 'lucide-react';

type Grant = {
  id: string;
  clinic: { id: string; name: string };
  method: 'PIN' | 'OTP';
  grantedAt: string;
  revokedAt: string | null;
};

type AccessResponse = {
  origin: { clinic: { id: string; name: string }; grantedAt: string };
  grants: Grant[];
};

export default function PatientPortalAccessPage() {
  const [data, setData] = useState<AccessResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const fetchAccess = async () => {
    const token = localStorage.getItem('patientToken');
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patient-portal/access`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (body.success) setData(body);
      else setError(body.error || 'Unable to load access');
    } catch {
      setError('Unable to reach the Bulamu API');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccess();
  }, []);

  const handleRevoke = async (grantId: string, clinicName: string) => {
    if (!confirm(`Revoke ${clinicName}'s access to your records? They will no longer appear in your portal, and staff there will need to verify you again before adding a new visit.`)) return;
    setRevokingId(grantId);
    try {
      const token = localStorage.getItem('patientToken');
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/patient-portal/access/${grantId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error || 'Could not revoke access');
      await fetchAccess();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setRevokingId(null);
    }
  };

  if (loading) return <div className="p-8 text-center text-slate-500 dark:text-slate-400">Loading...</div>;
  if (error) return <div className="p-8 text-center text-red-600">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-950 dark:text-slate-50">Facilities with access to your records</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Every facility below can see your history through your Bulamu account. You can revoke access at any time.
        </p>
      </div>

      <Card className="rounded-lg border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-emerald-700" aria-hidden="true" />
          <p className="font-medium text-slate-800 dark:text-slate-200">{data.origin.clinic.name}</p>
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Created your account on {new Date(data.origin.grantedAt).toLocaleDateString()} - this facility's access can't be revoked here.
        </p>
      </Card>

      {data.grants.length === 0 ? (
        <Card className="rounded-lg border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm text-slate-500 dark:text-slate-400">No other facility has been linked yet.</p>
        </Card>
      ) : (
        data.grants.map((g) => (
          <Card key={g.id} className="rounded-lg border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Building2 className="size-4 text-slate-500" aria-hidden="true" />
                  <p className="font-medium text-slate-800 dark:text-slate-200">{g.clinic.name}</p>
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Verified {new Date(g.grantedAt).toLocaleDateString()} via {g.method === 'PIN' ? 'your password' : 'email code'}
                  {g.revokedAt ? ` - revoked ${new Date(g.revokedAt).toLocaleDateString()}` : ''}
                </p>
              </div>
              {!g.revokedAt && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={revokingId === g.id}
                  onClick={() => handleRevoke(g.id, g.clinic.name)}
                  className="shrink-0 text-rose-600 hover:text-rose-700"
                >
                  Revoke
                </Button>
              )}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
