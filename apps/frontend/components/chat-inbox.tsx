'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Building2, ChevronDown, MessageCircle, Pin, Plus, Search, Send, ShieldCheck, Smile, Users } from 'lucide-react';
import { NOTIFICATIONS_CHANGED_EVENT } from '@/lib/useUnreadNotifications';

type Mode = 'staff' | 'patient' | 'super';
type Member = { id: string; name: string; role: string };
type Thread = {
  id: string; kind?: string; clinicId?: string; clinicName?: string | null; groupType?: string | null;
  groupName?: string | null; groupRole?: string | null; members?: Member[]; memberCount?: number; isPinned?: boolean;
  patientAccount?: { id: string; email: string }; userA?: Member; userB?: Member | null;
  lastMessage?: { body: string; createdAt: string } | null; unreadCount?: number;
};
type ChatMessage = { id: string; body: string; createdAt: string; authorUserId?: string | null; authorName?: string | null; authorPatientAccountId?: string | null };
type Staff = Member & { extraRoles?: string[] };
type Clinic = { id: string; name: string };

const API = process.env.NEXT_PUBLIC_API_URL;
const EMOJI = ['😀', '😊', '🙂', '😂', '🙏', '👍', '❤️', '🎉', '✅', '👏', '🤝', '💡', '🩺', '🌿', '☀️', '🙌'];
const ROLE_LABEL: Record<string, string> = { ADMIN: 'Admin', DOCTOR: 'Doctor', NURSE: 'Nurse', PHARMACIST: 'Pharmacist', STAFF: 'Staff', LAB_TECH: 'Lab', RADIOGRAPHER: 'Imaging' };
const authHeaders = (key: string) => ({ Authorization: `Bearer ${typeof window === 'undefined' ? '' : localStorage.getItem(key)}` });
const identity = () => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } };

function initials(name?: string | null) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

export function ChatInbox({ mode }: { mode: Mode }) {
  const tokenKey = mode === 'patient' ? 'patientToken' : 'token';
  const [threads, setThreads] = useState<Thread[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [selectedClinic, setSelectedClinic] = useState('');
  const [selected, setSelected] = useState<Thread | null>(null);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [showStart, setShowStart] = useState(false);
  const [groupType, setGroupType] = useState<'FACILITY' | 'ROLE' | 'CUSTOM'>('FACILITY');
  const [groupRole, setGroupRole] = useState('DOCTOR');
  const [groupName, setGroupName] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [showEmoji, setShowEmoji] = useState(false);
  const [sendEmail, setSendEmail] = useState(false);

  const request = useCallback(async (path: string, init?: RequestInit) => {
    const response = await fetch(`${API}${path}`, { ...init, headers: { ...authHeaders(tokenKey), ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers }, cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Chatroom could not complete that request');
    return data;
  }, [tokenKey]);

  const listThreads = useCallback(async () => {
    const roles = [identity().role, ...(Array.isArray(identity().extraRoles) ? identity().extraRoles : [])];
    const canSeePatientChats = ['DOCTOR', 'NURSE', 'ADMIN'].some((role) => roles.includes(role));
    const paths = mode === 'patient' ? ['/patient-portal/chat/threads'] : mode === 'super' ? ['/chat/super-admin/threads'] : canSeePatientChats ? ['/chat/threads', '/chat/patient-threads'] : ['/chat/threads'];
    const results = await Promise.all(paths.map(async (path) => (await request(path)).threads as Thread[]));
    const all = results.flat();
    setThreads(all);
    setSelected((current) => current ? all.find((item) => item.id === current.id) ?? null : null);
    return all;
  }, [mode, request]);

  useEffect(() => {
    let live = true;
    async function load() {
      try {
        await listThreads();
        if (mode === 'staff') {
          const data = await request('/chat/staff');
          if (live) setStaff(data.users ?? []);
        } else if (mode === 'patient') {
          const data = await request('/patient-portal/chat/clinics');
          if (live) setClinics(data.clinics ?? []);
        } else if (mode === 'super') {
          const data = await request('/chat/super-admin/clinics');
          if (live) setClinics(data.clinics ?? []);
        }
      } catch (e) { if (live) setError(e instanceof Error ? e.message : 'Could not load Chatroom'); }
      finally { if (live) setLoading(false); }
    }
    void load();
    return () => { live = false; };
  }, [listThreads, mode, request]);

  const base = mode === 'patient' ? '/patient-portal/chat/threads' : mode === 'super' ? '/chat/super-admin/threads' : selected?.kind === 'PATIENT_STAFF' ? '/chat/patient-threads' : '/chat/threads';
  const threadPath = selected ? `${base}/${selected.id}` : '';
  const loadMessages = useCallback(async () => {
    const selectedId = selected?.id;
    if (!selectedId || !threadPath || document.visibilityState === 'hidden') return;
    try {
      const last = messagesRef.current[messagesRef.current.length - 1];
      const data = await request(`${threadPath}/messages${last ? `?after=${encodeURIComponent(last.createdAt)}` : ''}`);
      if (Array.isArray(data.messages)) {
        const next = (data.messages as ChatMessage[]).reverse();
        const combined = last
          ? [...messagesRef.current, ...next.filter((message) => !messagesRef.current.some((existing) => existing.id === message.id))]
          : next;
        messagesRef.current = combined;
        setMessages(combined);
        const readPath = mode === 'super' ? `/chat/super-admin/threads/${selectedId}/read` : `${threadPath}/read`;
        const hasIncoming = next.some((message) => mode === 'patient' ? !!message.authorUserId : message.authorUserId !== identity().id && !message.authorPatientAccountId);
        if (hasIncoming) {
          await request(readPath, { method: 'POST' });
          window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
        }
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load this conversation'); }
  }, [mode, request, selected?.id, threadPath]);

  useEffect(() => {
    messagesRef.current = [];
    setMessages([]); setSendEmail(false);
    if (!selected?.id) return;
    void loadMessages();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void loadMessages(); }, 5000);
    const onFocus = () => void loadMessages();
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [selected?.id, loadMessages]);

  const titleFor = (thread: Thread) => {
    if (thread.kind === 'PATIENT_STAFF') return mode === 'patient' ? thread.clinicName || clinics.find((c) => c.id === thread.clinicId)?.name || 'Clinic' : thread.patientAccount?.email || 'Patient';
    if (thread.kind === 'ADMIN_SUPER') return mode === 'super' ? thread.clinicName || thread.userA?.name || 'Facility administrator' : 'Bulamu Support';
    if (thread.kind === 'STAFF_GROUP') return thread.groupName || 'Staff group';
    const me = identity().id;
    const peer = thread.userA?.id === me ? thread.userB : thread.userA;
    return peer?.name || 'Staff conversation';
  };

  const title = selected ? titleFor(selected) : '';
  const filteredThreads = useMemo(() => {
    const lower = query.trim().toLocaleLowerCase();
    return threads.filter((thread) => !lower || `${titleFor(thread)} ${thread.lastMessage?.body || ''}`.toLocaleLowerCase().includes(lower))
      .sort((a, b) => Number(!!b.isPinned) - Number(!!a.isPinned) || Date.parse(b.lastMessage?.createdAt || '') - Date.parse(a.lastMessage?.createdAt || ''));
  // titleFor uses the current local identity and clinic lookup.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads, query, clinics, mode]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !body.trim() || sending) return;
    setSending(true); setError('');
    try {
      await request(`${threadPath}/messages`, { method: 'POST', body: JSON.stringify({ body, ...(selected.kind === 'ADMIN_SUPER' ? { sendEmail } : {}) }) });
      setBody(''); setSendEmail(false); setShowEmoji(false);
      await Promise.all([loadMessages(), listThreads()]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Message could not be sent'); }
    finally { setSending(false); }
  };

  const openStaff = async (userId: string) => {
    try { const data = await request('/chat/threads', { method: 'POST', body: JSON.stringify({ toUserId: userId }) }); setSelected(data.thread); await listThreads(); setShowStart(false); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not open conversation'); }
  };

  const startGroup = async () => {
    try {
      const data = await request('/chat/groups', { method: 'POST', body: JSON.stringify({ groupType, groupRole: groupType === 'ROLE' ? groupRole : undefined, name: groupType === 'CUSTOM' ? groupName : undefined, memberIds: groupType === 'CUSTOM' ? memberIds : undefined }) });
      setSelected(data.thread); await listThreads(); setShowStart(false); setGroupName(''); setMemberIds([]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not start group chat'); }
  };

  const startSupport = async () => {
    try { const data = await request('/chat/admin-support', { method: 'POST' }); setSelected(data.thread); await listThreads(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not open support chat'); }
  };

  const startSuperSupport = async () => {
    if (!selectedClinic) return;
    try {
      const data = await request('/chat/super-admin/threads', { method: 'POST', body: JSON.stringify({ clinicId: selectedClinic }) });
      setSelected(data.thread);
      await listThreads();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not start facility chat'); }
  };

  const startPatient = async () => {
    if (!selectedClinic) return;
    try { const data = await request('/patient-portal/chat/threads', { method: 'POST', body: JSON.stringify({ clinicId: selectedClinic }) }); setSelected(data.thread); await listThreads(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not open clinic chat'); }
  };

  const togglePin = async () => {
    if (!selected) return;
    const pinned = !selected.isPinned;
    const path = mode === 'super' ? `/chat/super-admin/threads/${selected.id}/pin` : `/chat/threads/${selected.id}/pin`;
    try {
      await request(path, { method: 'POST', body: JSON.stringify({ pinned }) });
      setSelected({ ...selected, isPinned: pinned });
      setThreads((current) => current.map((thread) => thread.id === selected.id ? { ...thread, isPinned: pinned } : thread));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update pinned chats'); }
  };

  const identityValue = mode === 'patient' ? {} : identity();
  const identityRoles = [identityValue.role, ...(Array.isArray(identityValue.extraRoles) ? identityValue.extraRoles : [])];
  const canOpenSupport = mode === 'staff' && identityRoles.includes('ADMIN');
  const showPatientGroup = mode === 'staff' && ['DOCTOR', 'NURSE', 'ADMIN'].some((role) => [identityValue.role, ...(identityValue.extraRoles || [])].includes(role));

  return <section className="mx-auto max-w-7xl space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400"><MessageCircle className="size-4" /> In-app conversations</p><h1 className="text-2xl font-bold text-slate-950 dark:text-slate-50">Chatroom</h1><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Private conversations for the people you work with.</p></div>
      {mode === 'staff' && <div className="flex flex-wrap gap-2">{canOpenSupport && <button onClick={() => void startSupport()} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"><ShieldCheck className="size-4" /> Bulamu Support</button>}<button onClick={() => setShowStart((value) => !value)} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800"><Plus className="size-4" /> Start chat <ChevronDown className="size-4" /></button></div>}
      {mode === 'patient' && <div className="flex gap-2"><select aria-label="Choose a clinic" className="h-10 rounded-md border bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900" value={selectedClinic} onChange={(e) => setSelectedClinic(e.target.value)}><option value="">Choose a clinic...</option>{clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</select><button onClick={() => void startPatient()} disabled={!selectedClinic} className="rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white disabled:opacity-50">Message clinic</button></div>}
      {mode === 'super' && <div className="flex flex-wrap gap-2"><label className="sr-only" htmlFor="support-facility">Choose a facility</label><select id="support-facility" aria-label="Choose a facility" className="h-10 max-w-64 rounded-md border bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900" value={selectedClinic} onChange={(e) => setSelectedClinic(e.target.value)}><option value="">Choose a facility...</option>{clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</select><button onClick={() => void startSuperSupport()} disabled={!selectedClinic} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white disabled:opacity-50"><Plus className="size-4" /> Start facility chat</button></div>}
    </header>

    {showStart && mode === 'staff' && <section className="rounded-xl border border-emerald-200 bg-white p-4 shadow-sm dark:border-emerald-900 dark:bg-slate-900" aria-label="Start a chat">
      <div className="flex flex-wrap gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">{(['FACILITY', 'ROLE', 'CUSTOM'] as const).map((type) => <button key={type} onClick={() => setGroupType(type)} className={`rounded-full px-3 py-1.5 text-sm ${groupType === type ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>{type === 'FACILITY' ? 'Facility room' : type === 'ROLE' ? 'Role room' : 'Custom group'}</button>)}</div>
      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
        <div className="grid gap-3 sm:grid-cols-2">
          {groupType === 'FACILITY' && <p className="text-sm text-slate-600 dark:text-slate-300"><Building2 className="mr-2 inline size-4" />A shared room for active staff at this facility.</p>}
          {groupType === 'ROLE' && <label className="text-sm font-medium">Facility role<select value={groupRole} onChange={(e) => setGroupRole(e.target.value)} className="mt-1 block h-10 w-full rounded-md border bg-white px-2 dark:border-slate-700 dark:bg-slate-950">{['ADMIN', 'DOCTOR', 'NURSE', 'PHARMACIST', 'STAFF', 'LAB_TECH', 'RADIOGRAPHER'].map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}</select></label>}
          {groupType === 'CUSTOM' && <><label className="text-sm font-medium">Group name<input value={groupName} onChange={(e) => setGroupName(e.target.value)} maxLength={60} placeholder="e.g. Outreach team" className="mt-1 block h-10 w-full rounded-md border bg-white px-3 dark:border-slate-700 dark:bg-slate-950" /></label><label className="text-sm font-medium">People<select multiple value={memberIds} onChange={(e) => setMemberIds(Array.from(e.target.selectedOptions, (o) => o.value))} className="mt-1 block h-24 w-full rounded-md border bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950">{staff.map((person) => <option key={person.id} value={person.id}>{person.name} · {ROLE_LABEL[person.role] || person.role}</option>)}</select><span className="text-xs font-normal text-slate-500">Choose up to 30 active staff. You are included automatically.</span></label></>}
          {groupType === 'FACILITY' && staff.length > 0 && <label className="text-sm font-medium">Or message one colleague<select defaultValue="" onChange={(e) => { if (e.target.value) void openStaff(e.target.value); }} className="mt-1 block h-10 w-full rounded-md border bg-white px-2 dark:border-slate-700 dark:bg-slate-950"><option value="">Choose a colleague...</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.name} · {ROLE_LABEL[person.role] || person.role}</option>)}</select></label>}
        </div><button onClick={() => void startGroup()} disabled={groupType === 'CUSTOM' && (!groupName.trim() || memberIds.length > 30)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50"><Users className="size-4" /> Open room</button>
      </div>
      {showPatientGroup && <p className="mt-3 text-xs text-slate-500">Patient conversations appear in your list when your role has access to those records.</p>}
    </section>}

    {error && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{error}<button className="ml-3 underline" onClick={() => setError('')}>Dismiss</button></p>}

    <div className="grid min-h-[68vh] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:grid-cols-[19rem_1fr] dark:border-slate-800 dark:bg-slate-900">
      <aside className={`border-b border-slate-200 md:border-b-0 md:border-r dark:border-slate-800 ${selected ? 'hidden md:block' : ''}`}>
        <div className="space-y-3 p-3"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Conversations</h2><span className="text-xs text-slate-500">{threads.length}</span></div><label className="relative block"><Search className="absolute left-2.5 top-2.5 size-4 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" aria-label="Search conversations" className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 pl-8 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950" /></label></div>
        {loading ? <p className="px-3 py-5 text-sm text-slate-500">Loading conversations…</p> : filteredThreads.length === 0 ? <p className="px-3 py-5 text-sm text-slate-500">{threads.length ? 'No matching chats.' : 'No conversations yet. Start a chat to get going.'}</p> : <ul>{filteredThreads.map((thread) => {
          const chatTitle = titleFor(thread);
          return <li key={thread.id}><button onClick={() => setSelected(thread)} className={`flex w-full gap-3 border-t border-slate-100 px-3 py-3 text-left hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800 ${selected?.id === thread.id ? 'bg-emerald-50 dark:bg-emerald-950/30' : ''}`}>
            <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">{thread.kind === 'STAFF_GROUP' ? <Users className="size-5" /> : thread.kind === 'ADMIN_SUPER' ? <ShieldCheck className="size-5" /> : initials(chatTitle)}{thread.isPinned && <Pin className="absolute -right-1 -top-1 size-3 fill-amber-400 text-amber-600" />}</span>
            <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{chatTitle}</span>{!!thread.unreadCount && <span className="rounded-full bg-emerald-700 px-1.5 text-[11px] font-bold text-white">{thread.unreadCount > 99 ? '99+' : thread.unreadCount}</span>}</span><span className="mt-1 block truncate text-xs text-slate-500">{thread.lastMessage?.body || (thread.groupType === 'ROLE' ? `${ROLE_LABEL[thread.groupRole || ''] || 'Role'} room · ` : '') + 'Start the conversation'}</span><span className="mt-1 block text-[11px] text-slate-400">{thread.kind === 'STAFF_GROUP' ? `${thread.memberCount ?? thread.members?.length ?? 0} people` : thread.kind === 'PATIENT_STAFF' ? 'Patient chat' : thread.kind === 'ADMIN_SUPER' ? 'Bulamu Support' : 'Direct message'}</span></span>
          </button></li>;
        })}</ul>}
      </aside>
      <div className={`${selected ? '' : 'hidden md:flex'} min-w-0 flex-col`}>
        {!selected ? <div className="hidden flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-slate-500 md:flex"><MessageCircle className="size-9 text-emerald-700" /><span>Choose a conversation to read and reply.</span><span className="text-xs">Messages stay in Chatroom. Attachments are not available.</span></div> : <>
          <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800"><button className="md:hidden" aria-label="Back to conversations" onClick={() => setSelected(null)}><ArrowLeft className="size-5" /></button><span className="flex size-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">{selected.kind === 'STAFF_GROUP' ? <Users className="size-5" /> : initials(title)}</span><div className="min-w-0 flex-1"><h2 className="truncate font-semibold text-slate-950 dark:text-slate-100">{title}</h2><p className="text-xs text-slate-500">{selected.kind === 'PATIENT_STAFF' ? 'Patient conversation' : selected.kind === 'ADMIN_SUPER' ? 'Bulamu Support · secure in-app chat' : selected.kind === 'STAFF_GROUP' ? `${selected.memberCount ?? selected.members?.length ?? 0} members · facility-scoped` : 'Staff direct message'}</p></div>{selected.kind !== 'PATIENT_STAFF' && <button onClick={() => void togglePin()} aria-label={selected.isPinned ? 'Unpin conversation' : 'Pin conversation'} title={selected.isPinned ? 'Unpin conversation' : 'Pin conversation'} className={`flex size-9 items-center justify-center rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 ${selected.isPinned ? 'text-amber-600' : 'text-slate-500'}`}><Pin className={`size-4 ${selected.isPinned ? 'fill-amber-300' : ''}`} /></button>}</header>
          {selected.kind === 'STAFF_GROUP' && selected.members?.length ? <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500 dark:border-slate-800">{selected.members.map((member) => member.name).join(' · ')}</p> : null}
          <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/70 p-4 dark:bg-slate-950/30" aria-live="polite">{messages.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No messages yet. Send the first one below.</p> : messages.map((message) => {
            const mine = mode === 'patient' ? !!message.authorPatientAccountId : message.authorUserId === identityValue.id;
            return <article key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${mine ? 'rounded-br-md bg-emerald-700 text-white' : 'rounded-bl-md border border-slate-200 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'}`}><p className={`mb-1 text-[11px] font-semibold ${mine ? 'text-emerald-100' : 'text-slate-500 dark:text-slate-400'}`}>{mine ? 'You' : message.authorName || (message.authorPatientAccountId ? 'Patient' : 'Staff')} · {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p><p className="whitespace-pre-wrap break-words">{message.body}</p></div></article>;
          })}</div>
          <form onSubmit={send} className="relative border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            {selected.kind === 'ADMIN_SUPER' && <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800"><span className="text-slate-600 dark:text-slate-300">Email a notification too? The email contains no chat text.</span><label className="inline-flex items-center gap-2 font-medium"><input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} /> Email notice</label></div>}
            {showEmoji && <div className="absolute bottom-20 left-3 z-10 grid grid-cols-8 gap-1 rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900" aria-label="Emoji picker">{EMOJI.map((emoji) => <button key={emoji} type="button" onClick={() => setBody((value) => value + emoji)} className="rounded p-1.5 text-lg hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={`Insert ${emoji}`}>{emoji}</button>)}</div>}
            <div className="flex items-end gap-2"><button type="button" aria-label="Choose emoji" onClick={() => setShowEmoji((value) => !value)} className="flex size-10 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><Smile className="size-5" /></button><label className="sr-only" htmlFor="chat-body">Message</label><textarea id="chat-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={2} required placeholder="Write a message…" className="min-h-10 flex-1 resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white" /><button type="submit" disabled={sending || !body.trim()} className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"><Send className="size-4" /><span className="hidden sm:inline">Send</span></button></div>
            <p className="mt-1.5 pl-11 text-[11px] text-slate-400">In-app only · no attachments · up to 2,000 characters</p>
          </form>
        </>}
      </div>
    </div>
    <Link href={mode === 'patient' ? '/patient-portal/dashboard' : mode === 'super' ? '/super-admin' : '/dashboard'} className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">Back to {mode === 'patient' ? 'your records' : 'dashboard'}</Link>
  </section>;
}
