'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Building2, ChevronDown, MessageCircle, Pin, Plus, Reply, Search, Send, ShieldCheck, Smile, ThumbsUp, Users } from 'lucide-react';
import { NOTIFICATIONS_CHANGED_EVENT } from '@/lib/useUnreadNotifications';

type Mode = 'staff' | 'patient' | 'super';
type Member = { id: string; name: string; role: string };
type Thread = {
  id: string; kind?: string; clinicId?: string; clinicName?: string | null; groupType?: string | null;
  groupName?: string | null; groupRole?: string | null; members?: Member[]; memberCount?: number; isPinned?: boolean;
  patientAccount?: { id: string; email: string }; userA?: Member; userB?: Member | null;
  lastMessage?: { body: string; createdAt: string } | null; unreadCount?: number;
};
type ChatMessage = { id: string; body: string; createdAt: string; authorUserId?: string | null; authorName?: string | null; authorPatientAccountId?: string | null; likeCount: number; likedByMe: boolean; replyToMessage?: { id: string; body: string; authorName?: string | null } | null };
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
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [likingId, setLikingId] = useState<string | null>(null);
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
      const currentMessages = messagesRef.current;
      const data = await request(`${threadPath}/messages`);
      if (Array.isArray(data.messages)) {
        const next = (data.messages as ChatMessage[]).reverse();
        const newMessages = next.filter((message) => !currentMessages.some((existing) => existing.id === message.id));
        const refreshed = currentMessages.map((existing) => next.find((message) => message.id === existing.id) ?? existing);
        const combined = currentMessages.length ? [...refreshed, ...newMessages] : next;
        messagesRef.current = combined;
        setMessages(combined);
        const readPath = mode === 'super' ? `/chat/super-admin/threads/${selectedId}/read` : `${threadPath}/read`;
        const hasIncoming = newMessages.some((message) => mode === 'patient' ? !!message.authorUserId : message.authorUserId !== identity().id && !message.authorPatientAccountId);
        if (hasIncoming) {
          await request(readPath, { method: 'POST' });
          window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
          await listThreads();
        }
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load this conversation'); }
  }, [listThreads, mode, request, selected?.id, threadPath]);

  useEffect(() => {
    messagesRef.current = [];
    setMessages([]); setSendEmail(false);
    setReplyTarget(null);
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
      await request(`${threadPath}/messages`, { method: 'POST', body: JSON.stringify({ body, ...(replyTarget ? { replyToMessageId: replyTarget.id } : {}), ...(selected.kind === 'ADMIN_SUPER' ? { sendEmail } : {}) }) });
      setBody(''); setReplyTarget(null); setSendEmail(false); setShowEmoji(false);
      await Promise.all([loadMessages(), listThreads()]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Message could not be sent'); }
    finally { setSending(false); }
  };

  const toggleLike = async (message: ChatMessage) => {
    if (!selected || likingId) return;
    const liked = !message.likedByMe;
    const previous = { likedByMe: message.likedByMe, likeCount: message.likeCount };
    const update = (item: ChatMessage) => item.id === message.id ? { ...item, likedByMe: liked, likeCount: Math.max(0, item.likeCount + (liked ? 1 : -1)) } : item;
    setLikingId(message.id);
    messagesRef.current = messagesRef.current.map(update);
    setMessages(messagesRef.current);
    const path = mode === 'patient'
      ? `/patient-portal/chat/threads/${selected.id}/messages/${message.id}/like`
      : mode === 'super'
        ? `/chat/super-admin/threads/${selected.id}/messages/${message.id}/like`
        : selected.kind === 'PATIENT_STAFF'
          ? `/chat/patient-threads/${selected.id}/messages/${message.id}/like`
          : `/chat/threads/${selected.id}/messages/${message.id}/like`;
    try {
      const result = await request(path, { method: 'PUT', body: JSON.stringify({ liked }) });
      const saved = (item: ChatMessage) => item.id === message.id ? { ...item, likedByMe: result.liked, likeCount: result.likeCount } : item;
      messagesRef.current = messagesRef.current.map(saved);
      setMessages(messagesRef.current);
    } catch (e) {
      const restore = (item: ChatMessage) => item.id === message.id ? { ...item, ...previous } : item;
      messagesRef.current = messagesRef.current.map(restore);
      setMessages(messagesRef.current);
      setError(e instanceof Error ? e.message : 'Could not update the message like');
    } finally {
      setLikingId(null);
    }
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
  const unreadThreads = threads.filter((thread) => Number(thread.unreadCount) > 0).length;
  const pageDescription = mode === 'patient'
    ? 'Secure messages with clinics connected to your care.'
    : mode === 'super'
      ? 'Support conversations with facility administrators.'
      : 'Private conversations with your facility team and care network.';

  return <section className="mx-auto max-w-7xl space-y-5 py-2">
    <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-100 bg-gradient-to-br from-white via-white to-emerald-50/70 p-5 shadow-sm dark:border-slate-800 dark:from-slate-900 dark:via-slate-900 dark:to-emerald-950/20 sm:p-6">
      <div className="min-w-0"><p className="mb-1 flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-300"><MessageCircle className="size-4" aria-hidden="true" /> Secure in-app messaging</p><h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white">Chatroom</h1><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{pageDescription}</p></div>
      {mode === 'staff' && <div className="flex w-full flex-wrap gap-2 sm:w-auto">{canOpenSupport && <button onClick={() => void startSupport()} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"><ShieldCheck className="size-4" /> Bulamu Support</button>}<button onClick={() => setShowStart((value) => !value)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-700 px-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800"><Plus className="size-4" /> Start chat <ChevronDown className="size-4" /></button></div>}
      {mode === 'patient' && <div className="flex w-full flex-wrap gap-2 sm:w-auto"><label className="sr-only" htmlFor="patient-chat-clinic">Choose a clinic</label><select id="patient-chat-clinic" aria-label="Choose a clinic" className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:flex-none" value={selectedClinic} onChange={(e) => setSelectedClinic(e.target.value)}><option value="">Choose a clinic...</option>{clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</select><button onClick={() => void startPatient()} disabled={!selectedClinic} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-700 px-3.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"><Plus className="size-4" /> Message clinic</button></div>}
      {mode === 'super' && <div className="flex w-full flex-wrap gap-2 sm:w-auto"><label className="sr-only" htmlFor="support-facility">Choose a facility</label><select id="support-facility" aria-label="Choose a facility" className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:max-w-64" value={selectedClinic} onChange={(e) => setSelectedClinic(e.target.value)}><option value="">Choose a facility...</option>{clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</select><button onClick={() => void startSuperSupport()} disabled={!selectedClinic} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-700 px-3.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"><Plus className="size-4" /> Start facility chat</button></div>}
    </header>

    {showStart && mode === 'staff' && <section className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm dark:border-emerald-900 dark:bg-slate-900" aria-label="Start a chat">
      <div className="flex flex-wrap gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">{(['FACILITY', 'ROLE', 'CUSTOM'] as const).map((type) => <button key={type} onClick={() => setGroupType(type)} className={`rounded-full px-3.5 py-2 text-sm font-semibold transition ${groupType === type ? 'bg-emerald-700 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'}`}>{type === 'FACILITY' ? 'Facility room' : type === 'ROLE' ? 'Role room' : 'Custom group'}</button>)}</div>
      <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
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

    <div className="grid h-[min(74vh,780px)] min-h-[32rem] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:grid-cols-[19rem_minmax(0,1fr)] dark:border-slate-800 dark:bg-slate-900">
      <aside className={`flex min-h-0 flex-col border-b border-slate-200 bg-slate-50/70 md:border-b-0 md:border-r dark:border-slate-800 dark:bg-slate-950/30 ${selected ? 'hidden md:flex' : ''}`}>
        <div className="space-y-3 border-b border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between"><div><h2 className="text-sm font-bold text-slate-900 dark:text-white">Conversations</h2><p className="mt-0.5 text-xs text-slate-500">Your secure message threads</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{threads.length}</span></div>{unreadThreads > 0 && <p className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"><span className="size-2 rounded-full bg-emerald-600" />{unreadThreads} unread {unreadThreads === 1 ? 'conversation' : 'conversations'}</p>}<label className="relative block"><Search className="absolute left-3 top-2.5 size-4 text-slate-400" aria-hidden="true" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search conversations" aria-label="Search conversations" className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 dark:border-slate-700 dark:bg-slate-950 dark:focus:ring-emerald-950" /></label></div>
        <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? <p className="px-3 py-5 text-sm text-slate-500">Loading conversations…</p> : filteredThreads.length === 0 ? <p className="px-3 py-5 text-sm text-slate-500">{threads.length ? 'No matching chats.' : 'No conversations yet. Start a chat to get going.'}</p> : <ul>{filteredThreads.map((thread) => {
          const chatTitle = titleFor(thread);
          const unreadCount = Number(thread.unreadCount ?? 0);
          return <li key={thread.id}><button onClick={() => setSelected(thread)} aria-label={`${chatTitle}${unreadCount > 0 ? `, ${unreadCount} unread messages` : ''}`} className={`relative flex w-full gap-3 border-t border-slate-100 px-3.5 py-3.5 text-left transition hover:bg-white dark:border-slate-800 dark:hover:bg-slate-800 ${selected?.id === thread.id ? 'bg-white shadow-sm dark:bg-slate-800' : ''} ${unreadCount > 0 ? 'bg-emerald-50/60 dark:bg-emerald-950/20' : ''}`}>
            {unreadCount > 0 && <span className="absolute bottom-0 left-0 top-0 w-1 rounded-r bg-emerald-600" aria-hidden="true" />}
            <span className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">{thread.kind === 'STAFF_GROUP' ? <Users className="size-5" /> : thread.kind === 'ADMIN_SUPER' ? <ShieldCheck className="size-5" /> : initials(chatTitle)}{thread.isPinned && <Pin className="absolute -right-1 -top-1 size-3 fill-amber-400 text-amber-600" />}{unreadCount > 0 && <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-white bg-emerald-600 dark:border-slate-900" aria-hidden="true" />}</span>
            <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className={`truncate text-sm text-slate-900 dark:text-slate-100 ${unreadCount > 0 ? 'font-bold' : 'font-semibold'}`}>{chatTitle}</span>{unreadCount > 0 && <span className="shrink-0 rounded-full bg-emerald-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white" aria-label={`${unreadCount} unread messages`}>{unreadCount > 99 ? '99+' : `${unreadCount} new`}</span>}</span><span className={`mt-1 block truncate text-xs ${unreadCount > 0 ? 'font-medium text-slate-700 dark:text-slate-200' : 'text-slate-500'}`}>{thread.lastMessage?.body || (thread.groupType === 'ROLE' ? `${ROLE_LABEL[thread.groupRole || ''] || 'Role'} room · ` : '') + 'Start the conversation'}</span><span className="mt-1 block text-[11px] text-slate-400">{thread.kind === 'STAFF_GROUP' ? `${thread.memberCount ?? thread.members?.length ?? 0} people` : thread.kind === 'PATIENT_STAFF' ? 'Patient chat' : thread.kind === 'ADMIN_SUPER' ? 'Bulamu Support' : 'Direct message'}</span></span>
          </button></li>;
        })}</ul>}
        </div>
      </aside>
      <div className={`${selected ? 'flex' : 'hidden md:flex'} min-h-0 min-w-0 flex-col bg-white dark:bg-slate-900`}>
        {!selected ? <div className="hidden flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-slate-500 md:flex"><MessageCircle className="size-9 text-emerald-700" /><span>Choose a conversation to read and reply.</span><span className="text-xs">Messages stay in Chatroom. Attachments are not available.</span></div> : <>
          <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800"><button className="md:hidden" aria-label="Back to conversations" onClick={() => setSelected(null)}><ArrowLeft className="size-5" /></button><span className="flex size-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">{selected.kind === 'STAFF_GROUP' ? <Users className="size-5" /> : initials(title)}</span><div className="min-w-0 flex-1"><h2 className="truncate font-semibold text-slate-950 dark:text-slate-100">{title}</h2><p className="text-xs text-slate-500">{selected.kind === 'PATIENT_STAFF' ? 'Patient conversation' : selected.kind === 'ADMIN_SUPER' ? 'Bulamu Support · secure in-app chat' : selected.kind === 'STAFF_GROUP' ? `${selected.memberCount ?? selected.members?.length ?? 0} members · facility-scoped` : 'Staff direct message'}</p></div>{selected.kind !== 'PATIENT_STAFF' && <button onClick={() => void togglePin()} aria-label={selected.isPinned ? 'Unpin conversation' : 'Pin conversation'} title={selected.isPinned ? 'Unpin conversation' : 'Pin conversation'} className={`flex size-9 items-center justify-center rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 ${selected.isPinned ? 'text-amber-600' : 'text-slate-500'}`}><Pin className={`size-4 ${selected.isPinned ? 'fill-amber-300' : ''}`} /></button>}</header>
          {selected.kind === 'STAFF_GROUP' && selected.members?.length ? <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500 dark:border-slate-800">{selected.members.map((member) => member.name).join(' · ')}</p> : null}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-slate-50/70 p-4 dark:bg-slate-950/30 sm:p-6" aria-live="polite">{messages.length === 0 ? <div className="flex h-full min-h-40 flex-col items-center justify-center text-center"><span className="flex size-12 items-center justify-center rounded-full bg-white text-emerald-700 shadow-sm dark:bg-slate-900 dark:text-emerald-300"><MessageCircle className="size-5" /></span><p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-300">No messages yet</p><p className="mt-1 text-xs text-slate-500">Send the first message to get the conversation started.</p></div> : messages.map((message) => {
            const mine = mode === 'patient' ? !!message.authorPatientAccountId : message.authorUserId === identityValue.id;
            return <article id={`chat-message-${message.id}`} key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}><div className="max-w-[88%]"><div className={`rounded-2xl px-4 py-3 text-sm shadow-sm ${mine ? 'rounded-br-md bg-emerald-700 text-white' : 'rounded-bl-md border border-slate-200 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'}`}><p className={`mb-1.5 text-xs font-semibold ${mine ? 'text-emerald-100' : 'text-slate-500 dark:text-slate-400'}`}>{mine ? 'You' : message.authorName || (message.authorPatientAccountId ? 'Patient' : 'Staff')}</p>{message.replyToMessage && <button type="button" onClick={() => document.getElementById(`chat-message-${message.replyToMessage?.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className={`mb-2 block w-full rounded-md border-l-2 px-2 py-1 text-left text-xs ${mine ? 'border-emerald-200 bg-emerald-800/60 text-emerald-100' : 'border-emerald-600 bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}><span className="block font-semibold">{message.replyToMessage.authorName || 'Message'}</span><span className="line-clamp-2">{message.replyToMessage.body}</span></button>}<p className="whitespace-pre-wrap break-words leading-relaxed">{message.body}</p></div><div className="flex items-center gap-1"><button type="button" onClick={() => { setReplyTarget(message); document.getElementById('chat-body')?.focus(); }} aria-label="Reply to message" title="Reply to message" className="mt-1 inline-flex min-h-7 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 text-xs text-slate-500 transition hover:border-emerald-300 hover:text-emerald-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-emerald-300"><Reply className="size-3.5" aria-hidden="true" /><span>Reply</span></button><button type="button" disabled={likingId === message.id} aria-label={message.likedByMe ? 'Unlike message' : 'Like message'} aria-pressed={message.likedByMe} onClick={() => void toggleLike(message)} className={`mt-1 inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition disabled:opacity-60 ${message.likedByMe ? 'border-emerald-300 bg-emerald-50 font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' : 'border-slate-200 bg-white text-slate-500 hover:border-emerald-300 hover:text-emerald-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-emerald-300'}`}><ThumbsUp className={`size-3.5 ${message.likedByMe ? 'fill-current' : ''}`} aria-hidden="true" />{message.likeCount > 0 && <span>{message.likeCount}</span>}</button></div></div></article>;
          })}</div>
          <form onSubmit={send} className="relative border-t border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            {selected.kind === 'ADMIN_SUPER' && <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800"><span className="text-slate-600 dark:text-slate-300">Email a notification too? The email contains no chat text.</span><label className="inline-flex items-center gap-2 font-medium"><input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} /> Email notice</label></div>}
            {replyTarget && <div className="mb-2 flex items-center gap-3 rounded-lg border-l-2 border-emerald-600 bg-slate-50 px-3 py-2 dark:bg-slate-800"><Reply className="size-4 shrink-0 text-emerald-700 dark:text-emerald-300" /><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Replying to {replyTarget.authorName || (replyTarget.authorPatientAccountId ? 'Patient' : 'Staff')}</p><p className="truncate text-xs text-slate-500">{replyTarget.body}</p></div><button type="button" onClick={() => setReplyTarget(null)} aria-label="Cancel reply" className="rounded p-1 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700">×</button></div>}
            {showEmoji && <div className="absolute bottom-20 left-3 z-10 grid grid-cols-8 gap-1 rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900" aria-label="Emoji picker">{EMOJI.map((emoji) => <button key={emoji} type="button" onClick={() => setBody((value) => value + emoji)} className="rounded p-1.5 text-lg hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={`Insert ${emoji}`}>{emoji}</button>)}</div>}
            <div className="flex items-end gap-2"><button type="button" aria-label="Choose emoji" onClick={() => setShowEmoji((value) => !value)} className="flex size-11 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800"><Smile className="size-5" /></button><label className="sr-only" htmlFor="chat-body">Message</label><textarea id="chat-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={2} required placeholder="Write a message..." className="min-h-11 flex-1 resize-y rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-emerald-950" /><button type="submit" disabled={sending || !body.trim()} className="inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"><Send className="size-4" /><span className="hidden sm:inline">Send</span></button></div>
            <p className="mt-1.5 pl-11 text-[11px] text-slate-400">In-app only · no attachments · up to 2,000 characters</p>
          </form>
        </>}
      </div>
    </div>
    <Link href={mode === 'patient' ? '/patient-portal/dashboard' : mode === 'super' ? '/super-admin' : '/dashboard'} className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">Back to {mode === 'patient' ? 'your records' : 'dashboard'}</Link>
  </section>;
}
