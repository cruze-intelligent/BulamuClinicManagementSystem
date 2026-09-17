'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/useAuth';

export default function SyncActivityPage() {
  const { user } = useAuth();
  const [auditEntries, setAuditEntries] = useState<any[]>([]);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const role = user?.role;
  const isSuperAdmin = role === 'SUPER_ADMIN';
  const isAdmin = role === 'ADMIN';

  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };

    const auditUrl = isSuperAdmin
      ? `${process.env.NEXT_PUBLIC_API_URL}/audit-log`
      : isAdmin
      ? `${process.env.NEXT_PUBLIC_API_URL}/audit-log/${user.clinicId}`
      : `${process.env.NEXT_PUBLIC_API_URL}/audit-log/me`;

    const requests: Promise<any>[] = [fetch(auditUrl, { headers }).then((r) => r.json())];
    if (isAdmin) {
      requests.push(fetch(`${process.env.NEXT_PUBLIC_API_URL}/sync-conflicts/${user.clinicId}`, { headers }).then((r) => r.json()));
    }

    Promise.all(requests)
      .then(([auditData, conflictData]) => {
        if (auditData.success) setAuditEntries(auditData.entries);
        if (conflictData?.success) setConflicts(conflictData.conflicts);
      })
      .finally(() => setLoading(false));
  }, [user, isSuperAdmin, isAdmin]);

  const title = isSuperAdmin ? 'Network Activity' : isAdmin ? 'Facility Activity' : 'My Activity';
  const description = isSuperAdmin
    ? 'Who touched sensitive records across every facility on Bulamu.'
    : isAdmin
    ? 'Offline sync conflicts and who touched sensitive records at your facility.'
    : 'A record of the actions you have taken in Bulamu.';

  return (
    <div className="min-h-screen p-8 bg-slate-50 dark:bg-slate-950">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">{title}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">{description}</p>

        {loading ? (
          <p>Loading...</p>
        ) : (
          <>
            {isAdmin && (
              <>
                <h2 className="text-xl font-semibold mb-3">Sync Conflicts</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
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
              </>
            )}
            {auditEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity recorded yet</p>
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
                    <p className="text-muted-foreground">
                      by {e.actorRole}{isSuperAdmin && e.clinicName ? ` - ${e.clinicName}` : ''}
                    </p>
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
