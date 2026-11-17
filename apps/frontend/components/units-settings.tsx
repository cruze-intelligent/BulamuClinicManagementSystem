'use client';

import { useEffect, useState } from 'react';
import { Building2, Pencil, Plus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { STANDARD_UNITS, rememberDepartments, sortDepartments, type Department } from '@/lib/departments';

const API = process.env.NEXT_PUBLIC_API_URL;

async function call(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${localStorage.getItem('token')}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error || 'Something went wrong - please try again');
  return data;
}

/**
 * The facility's units - General OPD, Dentistry, Orthopaedics... Each has its
 * own waiting queue; visits, staff and wards belong to them; the monthly report
 * counts visits per unit. The administrator sets them up here.
 */
export function UnitsSettings({ clinicId, isAdmin }: { clinicId: string; isAdmin: boolean }) {
  const [units, setUnits] = useState<Department[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [ownName, setOwnName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    try {
      const data = await call(`/departments?clinicId=${clinicId}`);
      setUnits(data.departments);
      rememberDepartments(clinicId, data.departments, data.mine);
      setLoadError('');
    } catch {
      setLoadError(navigator.onLine ? 'Could not load your units - please try again.' : 'You are offline. Units are set up when the connection returns.');
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => { void load(); }, [clinicId]);

  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
      await load();
      setMessage({ ok: true, text: done });
    } catch (error: any) {
      setMessage({ ok: false, text: error.message });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const active = sortDepartments(units.filter((u) => u.isActive));
  const closed = sortDepartments(units.filter((u) => !u.isActive));
  const activeCodes = new Set(active.map((u) => u.code));
  const available = STANDARD_UNITS.filter((u) => !activeCodes.has(u.code));
  const toggle = (code: string) => setPicked((list) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]));

  const addPicked = () => run(async () => {
    for (const code of picked) await call('/departments', 'POST', { code });
    setPicked([]);
  }, picked.length === 1 ? 'The unit was added.' : `${picked.length} units were added.`);

  const addOwn = (event: React.FormEvent) => {
    event.preventDefault();
    const name = ownName.trim();
    if (!name) return;
    void run(async () => { await call('/departments', 'POST', { name }); setOwnName(''); }, `${name} was added.`);
  };

  return (
    <Card className="mt-4 p-5" data-testid="units-settings">
      <div className="flex items-center gap-2">
        <Building2 className="size-5 text-emerald-700" aria-hidden="true" />
        <h2 className="text-lg font-semibold">Units and departments</h2>
      </div>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        The clinics and departments that see patients here - General OPD, Dentistry, Orthopaedics and so on. Each unit has its own
        waiting queue, patients are booked into a unit, staff are assigned to the units they work in, and the monthly report counts
        visits per unit. A small facility can work as one unit and leave this empty.
      </p>

      {!loaded ? (
        <p className="mt-4 text-sm text-slate-500">Loading units...</p>
      ) : loadError ? (
        <p role="alert" className="mt-4 text-sm text-amber-700 dark:text-amber-400">{loadError}</p>
      ) : (
        <>
          {active.length === 0 ? (
            <p className="mt-4 rounded-md border border-dashed border-slate-300 p-3 text-sm text-slate-500 dark:border-slate-700">
              No units yet - the whole facility works as one.{isAdmin ? ' Add the units you run below.' : ''}
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {active.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                  {renaming?.id === u.id ? (
                    <form
                      className="flex flex-1 flex-wrap items-center gap-2"
                      onSubmit={(e) => { e.preventDefault(); void run(async () => { await call(`/departments/${u.id}`, 'PATCH', { name: renaming.name }); setRenaming(null); }, 'The unit was renamed.'); }}
                    >
                      <Label htmlFor={`rename-${u.id}`} className="sr-only">New name for {u.name}</Label>
                      <Input id={`rename-${u.id}`} className="max-w-xs" value={renaming.name} maxLength={60} onChange={(e) => setRenaming({ id: u.id, name: e.target.value })} autoFocus />
                      <Button type="submit" size="sm" disabled={busy}>Save</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setRenaming(null)}>Cancel</Button>
                    </form>
                  ) : (
                    <>
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 dark:text-slate-100">{u.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {u.staff ? `${u.staff} ${u.staff === 1 ? 'person works' : 'people work'} here` : 'No staff assigned yet - assign them under Staff'}
                          {u.code ? '' : ' · your own unit'}
                        </p>
                      </div>
                      {isAdmin && (
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => setRenaming({ id: u.id, name: u.name })} aria-label={`Rename ${u.name}`}><Pencil className="size-4" aria-hidden="true" /> Rename</Button>
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => call(`/departments/${u.id}`, 'PATCH', { isActive: false }), `${u.name} was closed. Its past visits keep its name.`)}>Close</Button>
                        </div>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {isAdmin && (
            <div className="mt-5 space-y-5">
              {available.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Add standard units</p>
                  <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Standard units">
                    {available.map((u) => {
                      const on = picked.includes(u.code);
                      return (
                        <button
                          key={u.code}
                          type="button"
                          aria-pressed={on}
                          title={u.hint}
                          onClick={() => toggle(u.code)}
                          className={`rounded-full border px-3 py-1 text-sm transition-colors ${on ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-slate-300 text-slate-700 hover:border-emerald-600 dark:border-slate-700 dark:text-slate-300'}`}
                        >
                          {u.name}
                        </button>
                      );
                    })}
                  </div>
                  <Button className="mt-3" size="sm" disabled={busy || picked.length === 0} onClick={addPicked}>
                    <Plus className="size-4" aria-hidden="true" /> {picked.length ? `Add ${picked.length} ${picked.length === 1 ? 'unit' : 'units'}` : 'Choose units to add'}
                  </Button>
                </div>
              )}

              <form onSubmit={addOwn} className="flex flex-wrap items-end gap-2">
                <div className="min-w-[14rem] flex-1">
                  <Label htmlFor="own-unit">A unit not in the list</Label>
                  <Input id="own-unit" className="mt-1" value={ownName} maxLength={60} placeholder="e.g. Sickle Cell Clinic" onChange={(e) => setOwnName(e.target.value)} />
                </div>
                <Button type="submit" variant="outline" disabled={busy || !ownName.trim()}><Plus className="size-4" aria-hidden="true" /> Add unit</Button>
              </form>

              {closed.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Closed units</p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {closed.map((u) => (
                      <li key={u.id} className="flex items-center gap-2 rounded-full border border-slate-200 py-1 pl-3 pr-1 text-sm text-slate-500 dark:border-slate-800">
                        {u.name}
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => call(`/departments/${u.id}`, 'PATCH', { isActive: true }), `${u.name} is open again.`)}>Open again</Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {message && <p role={message.ok ? 'status' : 'alert'} className={`mt-3 text-sm ${message.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>{message.text}</p>}
        </>
      )}
    </Card>
  );
}
