'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drafts: what someone has typed into a form and not saved yet, kept on this
 * device as they type - so a refresh, a closed tab, a dropped connection or a
 * session that ran out does not lose it. Each person's drafts are their own
 * (keyed by who is signed in) and are offered back only to them; a draft is
 * dropped once the form is saved, when it is discarded, or after a week.
 * They stay through signing out, like the records already on this device.
 */

export const DRAFT_PREFIX = 'bulamu:draft:';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type Stored<T> = { value: T; savedAt: string; label?: string; path?: string };
export type DraftSummary = { form: string; id: string; savedAt: string; label: string; path: string | null };

function signedInUserId(): string | null {
  try {
    return (JSON.parse(localStorage.getItem('user') || 'null') as { id?: string } | null)?.id ?? null;
  } catch {
    return null;
  }
}

const keyFor = (userId: string, form: string, id: string) => `${DRAFT_PREFIX}${userId}:${form}:${id}`;

export function readDraft<T>(form: string, id: string): Stored<T> | null {
  const user = signedInUserId();
  if (!user) return null;
  try {
    const raw = localStorage.getItem(keyFor(user, form, id));
    if (!raw) return null;
    const stored = JSON.parse(raw) as Stored<T>;
    if (!stored?.savedAt || Date.now() - Date.parse(stored.savedAt) > MAX_AGE_MS) {
      localStorage.removeItem(keyFor(user, form, id));
      return null;
    }
    return stored;
  } catch {
    return null;
  }
}

export function writeDraft<T>(form: string, id: string, value: T, meta: { label?: string; path?: string } = {}): string | null {
  const user = signedInUserId();
  if (!user) return null;
  const savedAt = new Date().toISOString();
  try {
    localStorage.setItem(keyFor(user, form, id), JSON.stringify({ value, savedAt, ...meta } satisfies Stored<T>));
    return savedAt;
  } catch {
    // Storage full or blocked: the form still works, only without a draft.
    return null;
  }
}

export function clearDraft(form: string, id: string) {
  const user = signedInUserId();
  if (!user) return;
  try {
    localStorage.removeItem(keyFor(user, form, id));
  } catch {
    // Nothing to clear.
  }
}

/** This person's drafts (of one form, or all), newest first. Old ones are dropped on the way. */
export function listDrafts(form?: string): DraftSummary[] {
  const user = signedInUserId();
  if (!user) return [];
  const mine = `${DRAFT_PREFIX}${user}:`;
  const found: DraftSummary[] = [];
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(mine)) continue;
      const [draftForm, ...rest] = key.slice(mine.length).split(':');
      if (form && draftForm !== form) continue;
      const stored = readDraft<unknown>(draftForm, rest.join(':'));
      if (stored) found.push({ form: draftForm, id: rest.join(':'), savedAt: stored.savedAt, label: stored.label ?? 'Unsaved form', path: stored.path ?? null });
    }
  } catch {
    return [];
  }
  return found.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** "10:42", or "21 Nov, 10:42" for an earlier day - when a draft was kept. */
export function draftTime(iso: string): string {
  const at = new Date(iso);
  const sameDay = at.toDateString() === new Date().toDateString();
  return at.toLocaleString('en-GB', sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * Keeps a form's draft as it is typed into, and brings it back when the form
 * opens again. `id` names this form's record (null until it is known - say,
 * until the patient is chosen); `ready` holds the restore back until the form
 * has its saved values, so the draft lands on top of them. Call `discard` once
 * the form is saved.
 */
export function useDraft<T>(options: {
  form: string;
  id: string | null;
  value: T;
  isEmpty: (value: T) => boolean;
  onRestore: (value: T) => void;
  ready?: boolean;
  label?: string;
  path?: string;
}) {
  const { form, id, value, isEmpty, onRestore, ready = true, label, path } = options;
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  // The record whose draft has been looked for: nothing is saved over a draft before it is restored.
  const checked = useRef<string | null>(null);
  // The draft write waiting for typing to pause - cancelled when the form is saved.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restore = useRef(onRestore);
  restore.current = onRestore;
  const serialized = JSON.stringify(value);

  useEffect(() => {
    if (!id || !ready || checked.current === id) return;
    checked.current = id;
    const stored = readDraft<T>(form, id);
    setSavedAt(null);
    setRestoredAt(null);
    if (stored && !isEmpty(stored.value)) {
      restore.current(stored.value);
      setRestoredAt(stored.savedAt);
      setSavedAt(stored.savedAt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, id, ready]);

  useEffect(() => {
    if (!id || checked.current !== id) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      const current = JSON.parse(serialized) as T;
      if (isEmpty(current)) {
        clearDraft(form, id);
        setSavedAt(null);
      } else {
        setSavedAt(writeDraft(form, id, current, { label, path }));
      }
    }, 700);
    return () => {
      if (pending.current) clearTimeout(pending.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, form, id, label, path]);

  /** Keeps the draft at once (the Save draft button). */
  const saveNow = useCallback(() => {
    if (!id) return null;
    const at = writeDraft(form, id, JSON.parse(serialized) as T, { label, path });
    setSavedAt(at);
    return at;
  }, [form, id, serialized, label, path]);

  /** Drops the draft - the form was saved, or the person chose to start again. */
  const discard = useCallback(() => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = null;
    if (id) clearDraft(form, id);
    setSavedAt(null);
    setRestoredAt(null);
  }, [form, id]);

  return { savedAt, restoredAt, saveNow, discard };
}
