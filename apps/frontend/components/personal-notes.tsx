'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, CalendarClock, Check, Circle, NotebookPen, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PERSONAL_NOTES_CHANGED_EVENT } from '@/lib/useUnreadNotifications';

type PersonalNote = {
  id: string;
  title: string;
  body: string;
  reminderAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ApiResponse<T> = { success?: boolean; error?: string } & T;
type FormValues = { title: string; body: string; reminderAt: string };
const EMPTY_FORM: FormValues = { title: '', body: '', reminderAt: '' };
const API = process.env.NEXT_PUBLIC_API_URL;

function localDateTimeValue(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function formatReminder(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function isOverdue(note: PersonalNote, now: number) {
  return Boolean(note.reminderAt && !note.completedAt && new Date(note.reminderAt).getTime() < now);
}

export function PersonalNotes({ basePath = '/notes', tokenKey = 'token', patientPortal = false }: { basePath?: string; tokenKey?: string; patientPortal?: boolean }) {
  const [notes, setNotes] = useState<PersonalNote[]>([]);
  const [form, setForm] = useState<FormValues>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  const request = useCallback(async <T,>(path = '', init: RequestInit = {}): Promise<ApiResponse<T>> => {
    const token = localStorage.getItem(tokenKey);
    const response = await fetch(`${API}${basePath}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'We could not save your notes. Try again.');
    return data as ApiResponse<T>;
  }, [basePath, tokenKey]);

  const loadNotes = useCallback(async () => {
    setError('');
    try {
      const data = await request<{ notes: PersonalNote[] }>();
      if (!data.success) throw new Error(data.error || 'We could not load your notes.');
      setNotes(data.notes);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not reach Bulamu. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    void loadNotes();
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, [loadNotes]);

  const sortedNotes = useMemo(() => [...notes].sort((a, b) => {
    if (a.completedAt !== null && b.completedAt === null) return 1;
    if (a.completedAt === null && b.completedAt !== null) return -1;
    if (a.reminderAt && b.reminderAt) return new Date(a.reminderAt).getTime() - new Date(b.reminderAt).getTime();
    if (a.reminderAt) return -1;
    if (b.reminderAt) return 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  }), [notes]);
  const remindersDue = notes.filter((note) => note.reminderAt && !note.completedAt && new Date(note.reminderAt).getTime() <= now).length;

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    const payload = {
      title: form.title.trim(),
      body: form.body.split('\n').map((line) => line.trim()).filter(Boolean).join('\n'),
      reminderAt: form.reminderAt ? new Date(form.reminderAt).toISOString() : null,
    };
    try {
      if (editingId) {
        const data = await request<{ note: PersonalNote }>(`/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) });
        if (!data.success || !data.note) throw new Error(data.error || 'Your note was not updated.');
        setNotes((current) => current.map((note) => note.id === editingId ? data.note : note));
      } else {
        const data = await request<{ note: PersonalNote }>('', { method: 'POST', body: JSON.stringify(payload) });
        if (!data.success || !data.note) throw new Error(data.error || 'Your note was not saved.');
        setNotes((current) => [data.note, ...current]);
      }
      window.dispatchEvent(new Event(PERSONAL_NOTES_CHANGED_EVENT));
      resetForm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your note could not be saved. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const edit = (note: PersonalNote) => {
    setForm({ title: note.title, body: note.body, reminderAt: localDateTimeValue(note.reminderAt) });
    setEditingId(note.id);
    setError('');
  };

  const toggleComplete = async (note: PersonalNote) => {
    setWorkingId(note.id);
    setError('');
    try {
      const data = await request<{ note: PersonalNote }>(`/${note.id}`, {
        method: 'PATCH', body: JSON.stringify({ completed: !note.completedAt }),
      });
      if (!data.success || !data.note) throw new Error(data.error || 'The reminder could not be updated.');
      setNotes((current) => current.map((item) => item.id === note.id ? data.note : item));
      window.dispatchEvent(new Event(PERSONAL_NOTES_CHANGED_EVENT));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The reminder could not be updated. Check your connection and try again.');
    } finally {
      setWorkingId(null);
    }
  };

  const remove = async (note: PersonalNote) => {
    if (!window.confirm('Delete this note? This cannot be undone.')) return;
    setWorkingId(note.id);
    setError('');
    try {
      await request(`/${note.id}`, { method: 'DELETE' });
      setNotes((current) => current.filter((item) => item.id !== note.id));
      window.dispatchEvent(new Event(PERSONAL_NOTES_CHANGED_EVENT));
      if (editingId === note.id) resetForm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The note could not be deleted. Check your connection and try again.');
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
            <NotebookPen className="size-5" aria-hidden="true" />
            <span className="text-sm font-medium">{patientPortal ? 'Your portal' : 'Personal workspace'}</span>
          </div>
          <h1 className="mt-2 text-3xl font-bold text-slate-900 dark:text-slate-50">Notes & reminders</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{patientPortal ? 'Jot down important points and reminders for yourself.' : 'Jot down important points and keep track of follow-ups.'}</p>
        </div>
        {remindersDue > 0 && (
          <div className="inline-flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200" role="status">
            <Bell className="size-4" aria-hidden="true" />
            {remindersDue} reminder{remindersDue === 1 ? '' : 's'} due
          </div>
        )}
      </div>

      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</p>}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.4fr)]">
        <Card className="gap-4 p-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{editingId ? 'Edit note' : 'Write a note'}</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Add one bullet or reminder item on each line.</p>
          </div>
          <form className="space-y-4" onSubmit={submit}>
            <div>
              <label htmlFor="note-title" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Title <span className="font-normal text-slate-400">(optional)</span></label>
              <Input id="note-title" value={form.title} maxLength={120} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="e.g. Follow up this week" />
            </div>
            <div>
              <label htmlFor="note-body" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Note</label>
              <Textarea id="note-body" required maxLength={5000} rows={6} value={form.body} onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))} placeholder={'Confirm the meeting time\nReview the new stock list'} />
            </div>
            <div>
              <label htmlFor="note-reminder" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Remind me on <span className="font-normal text-slate-400">(optional)</span></label>
              <Input id="note-reminder" type="datetime-local" value={form.reminderAt} onChange={(event) => setForm((current) => ({ ...current, reminderAt: event.target.value }))} />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">When it is due, it will be highlighted here and in your menu.</p>
            </div>
            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{patientPortal ? 'These notes are private to your Patient Portal account and are not shared with your clinic.' : 'These notes are private to your account and are not part of a patient record. Keep patient details in the patient record.'}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={saving || !form.body.trim()}>
                {editingId ? <Save className="size-4" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
                {saving ? 'Saving…' : editingId ? 'Save changes' : 'Save note'}
              </Button>
              {editingId && <Button type="button" variant="outline" onClick={resetForm}><X className="size-4" aria-hidden="true" />Cancel</Button>}
            </div>
          </form>
        </Card>

        <section aria-labelledby="saved-notes-heading" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id="saved-notes-heading" className="text-base font-semibold text-slate-900 dark:text-slate-100">Your notes</h2>
            {!loading && <span className="text-sm text-slate-500 dark:text-slate-400">{notes.length} saved</span>}
          </div>
          {loading ? (
            <Card className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">Loading your notes…</Card>
          ) : sortedNotes.length === 0 ? (
            <Card className="items-center p-8 text-center">
              <NotebookPen className="size-7 text-slate-400" aria-hidden="true" />
              <p className="mt-3 font-medium text-slate-800 dark:text-slate-200">No notes yet</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Your saved points and reminders will appear here.</p>
            </Card>
          ) : (
            sortedNotes.map((note) => {
              const overdue = isOverdue(note, now);
              return (
                <Card key={note.id} className={`gap-3 p-4 sm:p-5 ${overdue ? 'border-amber-300 dark:border-amber-800' : ''} ${note.completedAt ? 'opacity-75' : ''}`}>
                  <div className="flex items-start gap-3">
                    {note.reminderAt ? (
                      <button type="button" disabled={workingId === note.id} onClick={() => void toggleComplete(note)} aria-label={note.completedAt ? 'Reopen reminder' : 'Complete reminder'} className="mt-0.5 rounded-full text-slate-400 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-50 dark:hover:text-emerald-400">
                        {note.completedAt ? <Check className="size-5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" /> : <Circle className="size-5" aria-hidden="true" />}
                      </button>
                    ) : <span className="mt-0.5 size-5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true">•</span>}
                    <div className="min-w-0 flex-1">
                      <h3 className={`font-semibold text-slate-900 dark:text-slate-100 ${note.completedAt ? 'line-through' : ''}`}>{note.title || 'Untitled note'}</h3>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                        {note.body.split('\n').filter((line) => line.trim()).map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
                      </ul>
                      {note.reminderAt && (
                        <p className={`mt-3 inline-flex items-center gap-1.5 text-xs font-medium ${overdue ? 'text-amber-800 dark:text-amber-300' : 'text-slate-500 dark:text-slate-400'}`}>
                          <CalendarClock className="size-3.5" aria-hidden="true" />
                          {note.completedAt ? `Completed · ${formatReminder(note.completedAt)}` : `${overdue ? 'Overdue · ' : 'Reminder · '}${formatReminder(note.reminderAt)}`}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button type="button" size="icon-sm" variant="ghost" aria-label="Edit note" disabled={workingId === note.id} onClick={() => edit(note)}><Pencil className="size-4" aria-hidden="true" /></Button>
                      <Button type="button" size="icon-sm" variant="ghost" aria-label="Delete note" disabled={workingId === note.id} onClick={() => void remove(note)}><Trash2 className="size-4" aria-hidden="true" /></Button>
                    </div>
                  </div>
                </Card>
              );
            })
          )}
        </section>
      </div>
    </div>
  );
}
