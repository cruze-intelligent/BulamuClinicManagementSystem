'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';

export default function SyncActivityPage() {
  const [auditEntries, setAuditEntries] = useState<any[]>([]);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };

    Promise.all([
      fetch(`${process.env.NEXT_PUBLIC_API_URL}/audit-log/${user.clinicId}`, { headers }).then((r) => r.json()),
      fetch(`${process.env.NEXT_PUBLIC_API_URL}/sync-conflicts/${user.clinicId}`, { headers }).then((r) => r.json()),
    ])
      .then(([auditData, conflictData]) => {
        if (auditData.success) setAuditEntries(auditData.entries);
        if (conflictData.success) setConflicts(conflictData.conflicts);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen p-8 bg-slate-50">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Sync Activity</h1>
        <p className="text-sm text-slate-500 mb-6">
          Offline sync conflicts and who touched sensitive records, for facility oversight.
        </p>

        {loading ? (
          <p>Loading...</p>
        ) : (
          <>
            <h2 className="text-xl font-semibold mb-3">Sync Conflicts</h2>
            <p className="text-sm text-slate-500 mb-3">
              An older offline edit arrived after a newer one had already synced - the older edit was not applied.
            </p>
            {conflicts.length === 0 ? (
              <p className="text-sm text-muted-foreground mb-6">No conflicts recorded</p>
            ) : (
              <div className="space-y-2 mb-8">
                {conflicts.map((c: any) => (
                  <Card key={c.id} className="p-4 text-sm">
                    <p className="font-medium">{c.entity} #{c.recordId}</p>
                    <p className="text-muted-foreground">
                      Discarded write from {new Date(c.incomingUpdatedAt).toLocaleString()} (older than the stored
                      version from {new Date(c.currentUpdatedAt).toLocaleString()})
                    </p>
                  </Card>
                ))}
              </div>
            )}

            <h2 className="text-xl font-semibold mb-3">Audit Log</h2>
            {auditEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No audit entries yet</p>
            ) : (
              <div className="space-y-2">
                {auditEntries.map((e: any) => (
                  <Card key={e.id} className="p-4 text-sm">
                    <div className="flex justify-between">
                      <p className="font-medium">
                        {e.action} {e.entity} #{e.recordId}
                      </p>
                      <p className="text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</p>
                    </div>
                    <p className="text-muted-foreground">by {e.actorRole}</p>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
