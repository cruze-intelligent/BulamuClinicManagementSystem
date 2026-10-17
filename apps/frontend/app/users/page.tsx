'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronRight, KeyRound, Pencil, Search, Trash2, UserCheck, UserPlus, UserX, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { roleLabel } from '@/lib/role-labels';
import { Select } from '@/components/ui/select';
import { useAuth } from '@/lib/useAuth';
import { timeAgo } from '@/lib/analytics-format';

type StaffUser = { id: string; name: string; email: string; role: string; isActive: boolean; createdAt: string; lastLoginAt?: string | null };
type Panel = { userId: string; kind: 'edit' | 'password' | 'deactivate' | 'delete' } | null;

// The roles a facility administrator can give (never the platform administrator).
const ROLE_OPTIONS = [
  { value: 'DOCTOR', label: 'Doctor / Clinical Officer', hint: 'Consultations, prescriptions, lab orders, admissions and referrals.' },
  { value: 'NURSE', label: 'Nurse / Midwife', hint: 'Registers patients, runs the lab, records observations on the wards.' },
  { value: 'PHARMACIST', label: 'Pharmacist', hint: 'Dispensing and medicine stock.' },
  { value: 'STAFF', label: 'Front Desk', hint: 'Registers patients, books appointments, welcomes referred patients. No clinical records.' },
  { value: 'LAB_TECH', label: 'Lab Technician', hint: 'Receives lab orders and records results; a clinician verifies them before the patient is told.' },
  { value: 'ADMIN', label: 'Administrator', hint: 'Everything, plus staff, billing and reports. Give this to as few people as possible.' },
];

const ROLE_BADGE: Record<string, string> = {
  ADMIN: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
  DOCTOR: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  NURSE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  PHARMACIST: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  STAFF: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  LAB_TECH: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
};

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join('');

const API = process.env.NEXT_PUBLIC_API_URL;

async function call(path: string, method: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    // A JSON content type only with a body - the server refuses an empty JSON body.
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${localStorage.getItem('token')}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    const error = new Error(data.error || 'Something went wrong - please try again') as Error & { reason?: string };
    error.reason = data.reason;
    throw error;
  }
  return data;
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ email: '', password: '', name: '', role: 'STAFF' });
  const [formError, setFormError] = useState('');
  const [adding, setAdding] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const fetchUsers = async () => {
    const clinicId = JSON.parse(localStorage.getItem('user') || '{}').clinicId;
    try {
      const data = await call(`/users/${clinicId}`, 'GET');
      setUsers(Array.isArray(data.users) ? data.users : []);
      setLoadError('');
    } catch {
      setLoadError(navigator.onLine ? 'Could not load your staff - please try again.' : 'You are offline. Staff accounts load when the connection returns.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const addUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setAdding(true);
    try {
      await call('/users', 'POST', { ...formData, clinicId: me?.clinicId });
      setShowForm(false);
      setFormData({ email: '', password: '', name: '', role: 'STAFF' });
      setNotice(`${formData.name} was added. They sign in with ${formData.email} and the password you set - give it to them in person.`);
      fetchUsers();
    } catch (error: any) {
      setFormError(error.message);
    } finally {
      setAdding(false);
    }
  };

  const term = search.trim().toLowerCase();
  const matches = (u: StaffUser) => !term || u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term) || roleLabel(u.role).toLowerCase().includes(term);
  // You first, then everyone else by name.
  const byName = (a: StaffUser, b: StaffUser) => Number(b.id === me?.id) - Number(a.id === me?.id) || a.name.localeCompare(b.name);
  const active = users.filter((u) => u.isActive).sort(byName);
  const inactive = users.filter((u) => !u.isActive).sort(byName);
  const shownActive = active.filter(matches);
  const shownInactive = inactive.filter(matches);
  const roleHint = ROLE_OPTIONS.find((r) => r.value === formData.role)?.hint;

  const card = (user: StaffUser) => (
    <StaffCard
      key={user.id}
      user={user}
      isMe={user.id === me?.id}
      panel={panel?.userId === user.id ? panel.kind : null}
      setPanel={(kind) => { setNotice(''); setPanel(kind ? { userId: user.id, kind } : null); }}
      onChanged={(message) => { setPanel(null); setNotice(message); fetchUsers(); }}
    />
  );

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8 dark:bg-slate-950">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">Staff</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {loading ? 'Loading...' : `${active.length} active${inactive.length ? ` · ${inactive.length} deactivated` : ''}`}
            </p>
          </div>
          <Button onClick={() => { setShowForm(!showForm); setFormError(''); setNotice(''); }}>
            {showForm ? 'Cancel' : <><UserPlus className="size-4" aria-hidden="true" /> Add staff</>}
          </Button>
        </div>

        {notice && (
          <div role="status" className="mb-4 flex items-start justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            <span className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{notice}</span>
            <button type="button" onClick={() => setNotice('')} aria-label="Dismiss" className="shrink-0 rounded p-0.5 hover:bg-emerald-100 dark:hover:bg-emerald-900"><X className="size-4" aria-hidden="true" /></button>
          </div>
        )}
        {loadError && <p role="status" className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{loadError}</p>}

        {showForm && (
          <Card className="mb-6 p-5">
            <h2 className="text-lg font-semibold">Add a staff member</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Each person gets their own account - never share one. What they see depends on their role.</p>
            <form onSubmit={addUser} className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="name">Full name</Label>
                <Input id="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
              </div>
              <div>
                <Label htmlFor="email">Email (used to sign in)</Label>
                <Input id="email" type="email" autoComplete="off" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} required />
              </div>
              <div>
                <Label htmlFor="role">Role</Label>
                <Select id="role" value={formData.role} onChange={(e) => setFormData({ ...formData, role: e.target.value })}>
                  {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </Select>
                {roleHint && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{roleHint}</p>}
              </div>
              <div>
                <Label htmlFor="password">Starting password</Label>
                <Input id="password" type="password" autoComplete="new-password" minLength={8} value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} required />
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">At least 8 characters. They can change it with &quot;Forgot your password?&quot;.</p>
              </div>
              {formError && <p role="alert" className="text-sm text-red-600 sm:col-span-2">{formError}</p>}
              <div className="sm:col-span-2">
                <Button type="submit" disabled={adding}>{adding ? 'Adding...' : 'Add staff member'}</Button>
              </div>
            </form>
          </Card>
        )}

        {users.length > 6 && (
          <div className="relative mb-4 max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input aria-label="Search staff" placeholder="Search by name, email or role" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        )}

        {loading ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : (
          <>
            <div className="space-y-3">
              {shownActive.map(card)}
              {shownActive.length === 0 && term && <p className="text-sm text-slate-500 dark:text-slate-400">No active staff match &quot;{search}&quot;.</p>}
            </div>

            {inactive.length > 0 && (
              <section className="mt-8">
                <button type="button" onClick={() => setShowInactive((v) => !v)} aria-expanded={showInactive || !!term} className="flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100">
                  <ChevronRight className={`size-4 transition-transform ${showInactive || term ? 'rotate-90' : ''}`} aria-hidden="true" />
                  Deactivated ({inactive.length})
                </button>
                <p className="ml-5 text-xs text-slate-500 dark:text-slate-400">They can&apos;t sign in. Their records stay under their name.</p>
                {(showInactive || term) && <div className="mt-3 space-y-3">{shownInactive.map(card)}</div>}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StaffCard({
  user, isMe, panel, setPanel, onChanged,
}: {
  user: StaffUser;
  isMe: boolean;
  panel: NonNullable<Panel>['kind'] | null;
  setPanel: (kind: NonNullable<Panel>['kind'] | null) => void;
  onChanged: (message: string) => void;
}) {
  const [edit, setEdit] = useState({ name: user.name, email: user.email, role: user.role });
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hasRecords, setHasRecords] = useState(false);

  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError('');
    try {
      await action();
      onChanged(message);
    } catch (err: any) {
      setError(err.message);
      if (err.reason === 'HAS_RECORDS') setHasRecords(true);
    } finally {
      setBusy(false);
    }
  };

  const open = (kind: NonNullable<Panel>['kind']) => {
    setError('');
    setHasRecords(false);
    setEdit({ name: user.name, email: user.email, role: user.role });
    setPassword('');
    setPanel(kind);
  };

  // Your own account is only edited (name, email): another administrator
  // changes your role, password or access, so nobody can lock themselves out.
  return (
    <Card className={`p-4 ${user.isActive ? '' : 'opacity-80'}`} data-testid={`staff-${user.email}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div aria-hidden="true" className={`flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${ROLE_BADGE[user.role] ?? ROLE_BADGE.STAFF}`}>
            {initials(user.name)}
          </div>
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-2 font-semibold">
              <span className="break-words">{user.name}</span>
              {isMe && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">You</span>}
            </h3>
            <p className="break-all text-sm text-slate-500 dark:text-slate-400">{user.email}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
              <span className={`rounded px-2 py-0.5 font-medium ${ROLE_BADGE[user.role] ?? ROLE_BADGE.STAFF}`}>{roleLabel(user.role)}</span>
              {!user.isActive && <span className="rounded bg-red-100 px-2 py-0.5 font-medium text-red-800 dark:bg-red-950 dark:text-red-300">Deactivated</span>}
              {user.lastLoginAt !== undefined && (
                <span className="text-slate-500 dark:text-slate-400">{user.lastLoginAt ? `Last signed in ${timeAgo(user.lastLoginAt)}` : 'Never signed in'}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => open('edit')} aria-label={`Edit ${user.name}`}><Pencil className="size-4" aria-hidden="true" /> Edit</Button>
          {!isMe && <Button size="sm" variant="outline" onClick={() => open('password')} aria-label={`Reset password for ${user.name}`}><KeyRound className="size-4" aria-hidden="true" /> Password</Button>}
          {!isMe && (user.isActive ? (
            <Button size="sm" variant="outline" onClick={() => open('deactivate')} aria-label={`Deactivate ${user.name}`}><UserX className="size-4" aria-hidden="true" /> Deactivate</Button>
          ) : (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => call(`/users/${user.id}/activate`, 'PATCH'), `${user.name} can sign in again.`)}>
              <UserCheck className="size-4" aria-hidden="true" /> Reactivate
            </Button>
          ))}
          {!isMe && (
            <Button size="sm" variant="outline" className="text-red-700 hover:text-red-800 dark:text-red-400" onClick={() => open('delete')} aria-label={`Delete ${user.name}`}>
              <Trash2 className="size-4" aria-hidden="true" /> Delete
            </Button>
          )}
        </div>
      </div>

      {panel === 'edit' && (
        <form
          className="mt-4 grid gap-3 rounded-lg border border-slate-200 p-4 sm:grid-cols-3 dark:border-slate-800"
          aria-label={`Edit ${user.name}`}
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const { user: saved } = await call(`/users/${user.id}`, 'PATCH', isMe ? { name: edit.name, email: edit.email } : edit);
              // Your own name and email as shown in the menu.
              if (isMe) localStorage.setItem('user', JSON.stringify({ ...JSON.parse(localStorage.getItem('user') || '{}'), name: saved.name, email: saved.email }));
            }, `${edit.name}'s details were saved.${edit.role !== user.role ? ' They will be asked to sign in again with their new role.' : ''}`);
          }}
        >
          <div>
            <Label htmlFor={`name-${user.id}`}>Full name</Label>
            <Input id={`name-${user.id}`} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required />
          </div>
          <div>
            <Label htmlFor={`email-${user.id}`}>Email (used to sign in)</Label>
            <Input id={`email-${user.id}`} type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} required />
          </div>
          <div>
            <Label htmlFor={`role-${user.id}`}>Role</Label>
            <Select id={`role-${user.id}`} value={edit.role} disabled={isMe} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
              {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
            {isMe && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Another administrator can change your role.</p>}
          </div>
          {error && <p role="alert" className="text-sm text-red-600 sm:col-span-3">{error}</p>}
          <div className="flex gap-2 sm:col-span-3">
            <Button type="submit" size="sm" disabled={busy}>{busy ? 'Saving...' : 'Save'}</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setPanel(null)}>Cancel</Button>
          </div>
        </form>
      )}

      {panel === 'password' && (
        <form
          className="mt-4 rounded-lg border border-slate-200 p-4 dark:border-slate-800"
          aria-label={`Reset password for ${user.name}`}
          onSubmit={(e) => {
            e.preventDefault();
            run(() => call(`/users/${user.id}/password`, 'PATCH', { password }), `${user.name}'s password was changed and they were signed out everywhere. Give them the new password in person.`);
          }}
        >
          <Label htmlFor={`password-${user.id}`}>New password for {user.name}</Label>
          <Input id={`password-${user.id}`} type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 max-w-sm" />
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">At least 8 characters. They are signed out on every device and sign in again with this password.</p>
          {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
          <div className="mt-3 flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>{busy ? 'Saving...' : 'Set password'}</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setPanel(null)}>Cancel</Button>
          </div>
        </form>
      )}

      {panel === 'deactivate' && (
        <div role="alertdialog" aria-label={`Deactivate ${user.name}`} className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="font-semibold">Deactivate {user.name}?</p>
          <p className="mt-1">They are signed out at once and can no longer sign in. Everything they recorded stays, under their name. You can reactivate them later.</p>
          {error && <p role="alert" className="mt-2 font-medium">{error}</p>}
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => run(() => call(`/users/${user.id}/deactivate`, 'PATCH'), `${user.name} was deactivated.`)}>{busy ? 'Deactivating...' : 'Deactivate'}</Button>
            <Button size="sm" variant="outline" onClick={() => setPanel(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {panel === 'delete' && (
        <div role="alertdialog" aria-label={`Delete ${user.name}`} className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          <p className="font-semibold">Delete {user.name}&apos;s account?</p>
          <p className="mt-1">
            For an account added by mistake. An account someone has already worked under can&apos;t be deleted - every record must keep
            showing who made it - so deactivate it instead.
          </p>
          {error && <p role="alert" className="mt-2 font-medium">{error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {hasRecords ? (
              user.isActive && (
                <Button size="sm" variant="destructive" disabled={busy} onClick={() => run(() => call(`/users/${user.id}/deactivate`, 'PATCH'), `${user.name} was deactivated.`)}>
                  {busy ? 'Deactivating...' : 'Deactivate instead'}
                </Button>
              )
            ) : (
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => run(() => call(`/users/${user.id}`, 'DELETE'), `${user.name}'s account was deleted.`)}>
                {busy ? 'Deleting...' : 'Delete account'}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setPanel(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
