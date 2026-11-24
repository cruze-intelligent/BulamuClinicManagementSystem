import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { clearDraft, listDrafts, readDraft, useDraft, writeDraft } from './drafts';
import { clearStaffSession } from './staff-session';

const signIn = (id: string) => localStorage.setItem('user', JSON.stringify({ id, name: id }));

beforeEach(() => {
  localStorage.clear();
  signIn('doctor-1');
});
afterEach(() => vi.useRealTimers());

describe('drafts kept on this device', () => {
  it("are each person's own, listed newest first, dropped after a week, and survive signing out", () => {
    writeDraft('visit', 'p1-walk-in', { symptoms: 'Fever' }, { label: 'Visit - Achieng Mary', path: '/consultations/record?patientId=p1' });
    expect(readDraft('visit', 'p1-walk-in')?.value).toEqual({ symptoms: 'Fever' });
    expect(listDrafts().map((d) => [d.label, d.path])).toEqual([['Visit - Achieng Mary', '/consultations/record?patientId=p1']]);

    // Signing out keeps them (a session that ran out mid-visit); another person never sees them.
    clearStaffSession();
    signIn('nurse-2');
    expect(readDraft('visit', 'p1-walk-in')).toBeNull();
    expect(listDrafts()).toEqual([]);
    signIn('doctor-1');
    expect(readDraft('visit', 'p1-walk-in')?.value).toEqual({ symptoms: 'Fever' });

    // A week on, it is gone.
    const key = Object.keys(localStorage).find((k) => k.startsWith('bulamu:draft:doctor-1:visit:'))!;
    const stored = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key, JSON.stringify({ ...stored, savedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString() }));
    expect(listDrafts()).toEqual([]);
    expect(localStorage.getItem(key)).toBeNull();

    writeDraft('lab-result', 't1', { results: 'x' });
    clearDraft('lab-result', 't1');
    expect(readDraft('lab-result', 't1')).toBeNull();
  });

  it('brings a draft back when the form opens again, keeps what is typed, and drops it once saved', () => {
    vi.useFakeTimers();
    writeDraft('visit', 'p1', { symptoms: 'Cough 3 days' });
    const restored = vi.fn();
    let value = { symptoms: '' };
    const { result, rerender } = renderHook(() => useDraft({ form: 'visit', id: 'p1', value, isEmpty: (v) => !v.symptoms, onRestore: restored }));
    expect(restored).toHaveBeenCalledWith({ symptoms: 'Cough 3 days' });
    expect(result.current.restoredAt).not.toBeNull();

    value = { symptoms: 'Cough 3 days, fever' };
    rerender();
    act(() => { vi.advanceTimersByTime(800); });
    expect(readDraft('visit', 'p1')?.value).toEqual({ symptoms: 'Cough 3 days, fever' });
    expect(result.current.savedAt).not.toBeNull();

    // Saved: a keystroke just before saving does not bring the draft back.
    value = { symptoms: 'Cough 3 days, fever 38.5' };
    rerender();
    act(() => { result.current.discard(); });
    act(() => { vi.advanceTimersByTime(800); });
    expect(readDraft('visit', 'p1')).toBeNull();
  });

  it('does not save a form left as it opened', () => {
    vi.useFakeTimers();
    renderHook(() => useDraft({ form: 'visit', id: 'p2', value: { symptoms: '' }, isEmpty: (v) => !v.symptoms, onRestore: () => {} }));
    act(() => { vi.advanceTimersByTime(800); });
    expect(readDraft('visit', 'p2')).toBeNull();
  });
});
