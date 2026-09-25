'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useAuth } from '@/lib/useAuth';
import { downloadWithAuth } from '@/lib/download';

type AuditEntry = {
  id: string;
  action: string;
  entity: string;
  recordId: string;
  actorUserId: string;
  actorRole: string;
  actorName: string | null;
  clinicName?: string;
  createdAt: string;
};

export default function SyncActivityPage() {
  const { user } = useAuth();
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actorFilter, setActorFilter] = useState('');
  const [exporting, setExporting] = useState<'all' | 'actor' | null>(null);

  const role = user?.role;
  const clinicId = user?.clinicId;
  const signedIn = !!user;
  const isSuperAdmin = role === 'SUPER_ADMIN';
  const isAdmin = role === 'ADMIN';
  const canFilterByActor = isSuperAdmin || isAdmin;

  const auditUrl = (actorUserId?: string) => {
    const base = isSuperAdmin
      ? `${process.env.NEXT_PUBLIC_API_URL}/audit-log`
      : isAdmin
      ? `${process.env.NEXT_PUBLIC_API_URL}/audit-log/${clinicId}`
      : `${process.env.NEXT_PUBLIC_API_URL}/audit-log/me`;
    return actorUserId ? `${base}?actorUserId=${encodeURIComponent(actorUserId)}` : base;
  };

  const exportUrl = (actorUserId?: string) => {
    const base = isSuperAdmin
      ? `${process.env.NEXT_PUBLIC_API_URL}/audit-log/export`
      : isAdmin
      ? `${process.env.NEXT_PUBLIC_API_URL}/audit-log/${clinicId}/export`
      : `${process.env.NEXT_PUBLIC_API_URL}/audit-log/me/export`;
    return actorUserId ? `${base}?actorUserId=${encodeURIComponent(actorUserId)}` : base;
  };

  const fetchActivity = (actorUserId?: string) => {
    if (!signedIn) return;
    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };

    const requests: Promise<any>[] = [fetch(auditUrl(actorUserId), { headers }).then((r) => r.json())];
    if (isAdmin && !actorUserId) {
      requests.push(fetch(`${process.env.NEXT_PUBLIC_API_URL}/sync-conflicts/${clinicId}`, { headers }).then((r) => r.json()));
    }

    setLoading(true);
    Promise.all(requests)
      .then(([auditData, conflictData]) => {
        if (auditData.success) setAuditEntries(auditData.entries);
        if (conflictData?.success) setConflicts(conflictData.conflicts);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchActivity();
    // Runs once per sign-in (role/facility), not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, role, clinicId]);

  // The actor dropdown lists whoever has appeared in the loaded feed so far -
  // good enough to pick someone active and reachable without a separate
  // "list every user" call, and it re-populates as the unfiltered feed loads.
  const actors = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of auditEntries) {
      if (!seen.has(e.actorUserId)) seen.set(e.actorUserId, e.actorName || `${e.actorRole} (${e.actorUserId.slice(0, 8)})`);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [auditEntries]);

  const handleActorChange = (value: string) => {
    setActorFilter(value);
    fetchActivity(value || undefined);
  };

  const handleExport = async (scope: 'all' | 'actor') => {
    setExporting(scope);
    try {
      const url = scope === 'actor' ? exportUrl(actorFilter) : exportUrl();
      const filename = scope === 'actor'
        ? `bulamu-activity-${(actors.find(([id]) => id === actorFilter)?.[1] || actorFilter).replace(/[^\w-]+/g, '-')}.csv`
        : isSuperAdmin ? 'bulamu-platform-activity.csv' : isAdmin ? 'bulamu-facility-activity.csv' : 'bulamu-my-activity.csv';
      await downloadWithAuth(url, localStorage.getItem('token'), filename);
    } catch (err: any) {
      alert(err.message || 'Error exporting activity');
    } finally {
      setExporting(null);
    }
  };

  const title = isSuperAdmin ? 'Network Activity' : isAdmin ? 'Facility Activity' : 'My Activity';
  const description = isSuperAdmin
    ? 'Who touched sensitive records across every facility on Bulamu.'
    : isAdmin
    ? 'Offline sync conflicts and who touched sensitive records at your facility.'
    : 'A record of the actions you have taken in Bulamu.';

  return (
    <div className="min-h-screen p-8 bg-slate-50 dark:bg-slate-950">
      <div className="max-w-4xl mx-auto">
        <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-3xl font-bold">{title}</h1>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => handleExport('all')} disabled={exporting !== null}>
              <Download className="size-4" aria-hidden="true" />
              {exporting === 'all' ? 'Preparing...' : isSuperAdmin || isAdmin ? 'Export all (CSV)' : 'Export my activity (CSV)'}
            </Button>
            {canFilterByActor && actorFilter && (
              <Button size="sm" variant="outline" onClick={() => handleExport('actor')} disabled={exporting !== null}>
                <Download className="size-4" aria-hidden="true" />
                {exporting === 'actor' ? 'Preparing...' : 'Export for selected user (CSV)'}
              </Button>
            )}
          </div>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{description}</p>

        {canFilterByActor && (
          <div className="mb-6 max-w-xs">
            <Label htmlFor="actor-filter">Filter by user</Label>
            <Select id="actor-filter" className="mt-2" value={actorFilter} onChange={(e) => handleActorChange(e.target.value)}>
              <option value="">Everyone</option>
              {actors.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </Select>
          </div>
        )}

        {loading ? (
          <p>Loading...</p>
        ) : (
          <>
            {isAdmin && !actorFilter && (
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
                {auditEntries.map((e) => (
                  <Card key={e.id} className="p-4 text-sm">
                    <div className="flex justify-between">
                      <p className="font-medium">
                        {e.action} {e.entity} #{e.recordId}
                      </p>
                      <p className="text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</p>
                    </div>
                    <p className="text-muted-foreground">
                      by {e.actorName || e.actorRole}{isSuperAdmin && e.clinicName ? ` - ${e.clinicName}` : ''}
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
