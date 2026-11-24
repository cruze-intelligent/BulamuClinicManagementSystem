'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, MessageCircle, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Mode = 'staff' | 'patient' | 'super';
type Thread = { id: string; kind?: string; clinicId?: string; clinicName?: string | null; patientAccount?: { id: string; email: string }; userA?: { id: string; name: string; role: string }; userB?: { id: string; name: string; role: string } | null; lastMessage?: { body: string; createdAt: string } | null; unreadCount?: number };
type ChatMessage = { id: string; body: string; createdAt: string; authorUserId?: string | null; authorName?: string | null; authorPatientAccountId?: string | null };
type Staff = { id: string; name: string; role: string };
type Clinic = { id: string; name: string };
const API = process.env.NEXT_PUBLIC_API_URL;
const headers = (key: string) => ({ Authorization: `Bearer ${typeof window === 'undefined' ? '' : localStorage.getItem(key)}` });

export function ChatInbox({ mode }: { mode: Mode }) {
  const tokenKey = mode === 'patient' ? 'patientToken' : 'token';
  const [threads, setThreads] = useState<Thread[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [selectedClinic, setSelectedClinic] = useState('');
  const [selected, setSelected] = useState<Thread | null>(null);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const listThreads = useCallback(async () => {
    const identity = mode === 'staff' ? JSON.parse(localStorage.getItem('user') || '{}') : {};
    const roles = [identity.role, ...(Array.isArray(identity.extraRoles) ? identity.extraRoles : [])];
    const canSeePatientChats = ['DOCTOR', 'NURSE', 'ADMIN'].some((role) => roles.includes(role));
    const paths = mode === 'patient' ? ['/patient-portal/chat/threads'] : mode === 'super' ? ['/chat/super-admin/threads'] : canSeePatientChats ? ['/chat/threads', '/chat/patient-threads'] : ['/chat/threads'];
    const results = await Promise.all(paths.map(async (path) => {
      const response = await fetch(`${API}${path}`, { headers: headers(tokenKey), cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load messages');
      return data.threads as Thread[];
    }));
    const all = results.flat();
    setThreads(all);
    setSelected((current) => current ? all.find((item) => item.id === current.id) ?? current : null);
  }, [mode, tokenKey]);

  useEffect(() => {
    let live = true;
    async function load() {
      try {
        await listThreads();
        if (mode === 'staff') {
          const response = await fetch(`${API}/chat/staff`, { headers: headers(tokenKey) });
          const data = await response.json();
          if (response.ok && live) setStaff(data.users ?? []);
        } else if (mode === 'patient') {
          const response = await fetch(`${API}/patient-portal/chat/clinics`, { headers: headers(tokenKey) });
          const data = await response.json();
          const seen = new Map<string, string>();
          for (const clinic of data.clinics ?? []) seen.set(clinic.id, clinic.name);
          if (live) setClinics([...seen].map(([id, name]) => ({ id, name })));
        }
      } catch (e) { if (live) setError(e instanceof Error ? e.message : 'Could not load messages'); }
      finally { if (live) setLoading(false); }
    }
    void load();
    return () => { live = false; };
  }, [listThreads, mode, tokenKey]);

  const base = mode === 'patient' ? '/patient-portal/chat/threads' : mode === 'super' ? '/chat/super-admin/threads' : selected?.kind === 'PATIENT_STAFF' ? '/chat/patient-threads' : '/chat/threads';
  const threadPath = selected ? `${base}/${selected.id}` : '';
  const loadMessages = useCallback(async () => {
    if (!selected || !threadPath || document.visibilityState === 'hidden') return;
    try {
      const response = await fetch(`${API}${threadPath}/messages`, { headers: headers(tokenKey), cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load this conversation');
      if (Array.isArray(data.messages)) {
        const next = (data.messages as ChatMessage[]).reverse();
        setMessages(next);
        const newest = next[next.length - 1];
        const readPath = mode === 'super' ? `/chat/super-admin/threads/${selected.id}/read` : `${threadPath}/read`;
        if (newest) await fetch(`${API}${readPath}`, { method: 'POST', headers: headers(tokenKey) });
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load this conversation'); }
  }, [mode, selected, threadPath, tokenKey]);

  useEffect(() => {
    setMessages([]);
    if (!selected) return;
    void loadMessages();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void loadMessages(); }, 5000);
    const onFocus = () => void loadMessages();
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [selected, loadMessages]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !body.trim() || sending) return;
    setSending(true); setError('');
    try {
      const response = await fetch(`${API}${threadPath}/messages`, { method: 'POST', headers: { ...headers(tokenKey), 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Message could not be sent');
      setBody('');
      await Promise.all([loadMessages(), listThreads()]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Message could not be sent'); }
    finally { setSending(false); }
  };

  const startStaff = async (userId: string) => {
    try {
      const response = await fetch(`${API}/chat/threads`, { method: 'POST', headers: { ...headers(tokenKey), 'Content-Type': 'application/json' }, body: JSON.stringify({ toUserId: userId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not open conversation');
      setSelected(data.thread); await listThreads();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open conversation'); }
  };

  const startPatient = async () => {
    if (!selectedClinic) return;
    try {
      const response = await fetch(`${API}/patient-portal/chat/threads`, { method: 'POST', headers: { ...headers(tokenKey), 'Content-Type': 'application/json' }, body: JSON.stringify({ clinicId: selectedClinic }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not open conversation');
      await listThreads();
      setSelected(data.thread);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open conversation'); }
  };

  const title = useMemo(() => {
    if (!selected) return '';
    if (selected.kind === 'PATIENT_STAFF') return mode === 'patient' ? selected.clinicName || clinics.find((c) => c.id === selected.clinicId)?.name || 'Clinic' : selected.patientAccount?.email || 'Patient';
    if (selected.kind === 'ADMIN_SUPER') return mode === 'super' ? selected.userA?.name || selected.clinicName || 'Facility' : 'Bulamu Support';
    if (selected.kind === 'ADMIN_SUPER') return mode === 'super' ? selected.userA?.name || selected.clinicName || 'Facility' : 'Bulamu Support';
    const peer = selected.userA?.id === (typeof window === 'undefined' ? '' : JSON.parse(localStorage.getItem('user') || '{}').id) ? selected.userB : selected.userA;
    return peer?.name || 'Staff conversation';
  }, [clinics, mode, selected]);

  return <section className="mx-auto max-w-6xl space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">In-app messaging</p><h1 className="text-2xl font-bold text-slate-950 dark:text-slate-50">Messages</h1><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Conversations stay inside Bulamu.</p></div>
      {mode === 'staff' && <div className="flex flex-wrap gap-2">{staff.length > 0 && <select aria-label="Start a staff message" className="h-9 max-w-56 rounded-md border bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900" defaultValue="" onChange={(e) => { if (e.target.value) void startStaff(e.target.value); }}><option value="">Message a colleague...</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}</select>}{JSON.parse(typeof window === 'undefined' ? 'null' : localStorage.getItem('user') || 'null')?.role === 'ADMIN' && <Button size="sm" variant="outline" onClick={async () => { const r = await fetch(`${API}/chat/admin-support`, { method: 'POST', headers: headers(tokenKey) }); const d = await r.json(); if (r.ok) { setSelected(d.thread); await listThreads(); } else setError(d.error || 'Could not open support chat'); }}>Bulamu support</Button>}</div>}
      {mode === 'patient' && <div className="flex gap-2"><select aria-label="Choose a clinic" className="h-9 rounded-md border bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900" value={selectedClinic} onChange={(e) => setSelectedClinic(e.target.value)}><option value="">Choose a clinic...</option>{clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><Button size="sm" onClick={() => void startPatient()} disabled={!selectedClinic}>Message clinic</Button></div>}
    </header>
    {error && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{error}</p>}
    <div className="grid min-h-[65vh] overflow-hidden rounded-xl border border-slate-200 bg-white md:grid-cols-[18rem_1fr] dark:border-slate-800 dark:bg-slate-900">
      <aside className={`border-b border-slate-200 md:border-b-0 md:border-r dark:border-slate-800 ${selected ? 'hidden md:block' : ''}`}><div className="p-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Conversations</div>{loading ? <p className="px-3 py-5 text-sm text-slate-500">Loading conversations...</p> : threads.length === 0 ? <p className="px-3 py-5 text-sm text-slate-500">No conversations yet.</p> : <ul>{threads.map((t) => <li key={t.id}><button onClick={() => setSelected(t)} className={`w-full border-t border-slate-100 px-3 py-3 text-left hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800 ${selected?.id === t.id ? 'bg-emerald-50 dark:bg-emerald-950/30' : ''}`}><span className="flex items-center justify-between gap-2 text-sm font-medium text-slate-900 dark:text-slate-100"><span className="truncate">{t.kind === 'PATIENT_STAFF' ? mode === 'patient' ? t.clinicName || 'Clinic' : t.patientAccount?.email || 'Patient' : t.kind === 'ADMIN_SUPER' ? mode === 'super' ? t.userA?.name || t.clinicName || 'Facility' : 'Bulamu Support' : t.userA?.name || 'Staff conversation'}</span>{!!t.unreadCount && <span className="rounded-full bg-emerald-600 px-1.5 text-xs text-white">{t.unreadCount}</span>}</span><span className="mt-1 block truncate text-xs text-slate-500">{t.lastMessage?.body || 'Start the conversation'}</span></button></li>)}</ul>}</aside>
      <div className={`${selected ? '' : 'hidden md:flex'} min-w-0 flex-col`}>
        {!selected ? <div className="hidden flex-1 flex-col items-center justify-center gap-2 text-sm text-slate-500 md:flex"><MessageCircle className="size-8" /><span>Choose a conversation to read and reply.</span></div> : <><div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800"><button className="md:hidden" aria-label="Back to conversations" onClick={() => setSelected(null)}><ArrowLeft className="size-5" /></button><div><h2 className="font-semibold text-slate-950 dark:text-slate-100">{title}</h2><p className="text-xs text-slate-500">{selected.kind === 'PATIENT_STAFF' ? 'Patient conversation' : selected.kind === 'ADMIN_SUPER' ? 'Bulamu Support' : 'Staff direct message'}</p></div></div><div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">{messages.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No messages yet. Send the first one below.</p> : messages.map((m) => <article key={m.id} className="max-w-[85%] rounded-xl bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800"><p className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-400">{m.authorName || (m.authorPatientAccountId ? 'Patient' : 'Staff')} · {new Date(m.createdAt).toLocaleString()}</p><p className="whitespace-pre-wrap break-words text-slate-900 dark:text-slate-100">{m.body}</p></article>)}</div><form onSubmit={send} className="flex items-end gap-2 border-t border-slate-200 p-3 dark:border-slate-800"><label className="sr-only" htmlFor="chat-body">Message</label><textarea id="chat-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={2} required placeholder="Write a message..." className="min-h-10 flex-1 resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white" /><Button type="submit" disabled={sending || !body.trim()}><Send className="size-4" /> Send</Button></form></>}
      </div>
    </div>
    <Link href={mode === 'patient' ? '/patient-portal/dashboard' : mode === 'super' ? '/super-admin' : '/dashboard'} className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">Back to {mode === 'patient' ? 'your records' : 'dashboard'}</Link>
  </section>;
}
