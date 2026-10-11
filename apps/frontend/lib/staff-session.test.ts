import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearStaffSession, liveSessionUser, REMEMBERED_EMAIL_KEY, sessionEndMessage, tokenExpiry, watchForEndedSession } from './staff-session';

const tokenWithExp = (exp: number) => `x.${btoa(JSON.stringify({ userId: 'u1', exp })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.sig`;

describe('the staff session on this device', () => {
  beforeEach(() => localStorage.clear());

  it('reads when the session token runs out', () => {
    expect(tokenExpiry(tokenWithExp(1_800_000_000))).toBe(1_800_000_000_000);
    expect(tokenExpiry('not-a-token')).toBeNull();
    expect(tokenExpiry(null)).toBeNull();
  });

  it('only counts a session that has not run out as signed in', () => {
    localStorage.setItem('user', JSON.stringify({ role: 'NURSE' }));
    localStorage.setItem('token', tokenWithExp(Math.floor(Date.now() / 1000) + 3600));
    expect(liveSessionUser()).toEqual({ role: 'NURSE' });
    localStorage.setItem('token', tokenWithExp(Math.floor(Date.now() / 1000) - 60));
    expect(liveSessionUser()).toBeNull();
  });

  it('signing out keeps the remembered email and how far records are synced, and nothing else', () => {
    localStorage.setItem('token', 't');
    localStorage.setItem('user', '{}');
    localStorage.setItem('subscriptionSnapshot', '{}');
    localStorage.setItem(REMEMBERED_EMAIL_KEY, 'nurse@clinic.ug');
    localStorage.setItem('lastSyncedAt_clinic-1', '2026-10-11T08:00:00Z');

    clearStaffSession();

    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(localStorage.getItem('subscriptionSnapshot')).toBeNull();
    expect(localStorage.getItem(REMEMBERED_EMAIL_KEY)).toBe('nurse@clinic.ug');
    expect(localStorage.getItem('lastSyncedAt_clinic-1')).toBe('2026-10-11T08:00:00Z');
  });

  it('explains why someone is back on the sign-in page', () => {
    expect(sessionEndMessage('expired')).toMatch(/session has ended/);
    expect(sessionEndMessage('ended')).toMatch(/password was changed/);
    expect(sessionEndMessage(null)).toBeNull();
  });
});

describe('noticing that the server ended the session', () => {
  const api = 'https://api.example.test';
  let stop: () => void = () => {};

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', api);
    localStorage.clear();
    localStorage.setItem('token', 'staff-token');
  });

  afterEach(() => {
    stop();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const respond = (status: number, body: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));

  it('signs out when a staff request is refused because the session ended', async () => {
    respond(401, { error: 'Your session has ended. Please sign in again.', reason: 'SESSION_ENDED' });
    const onEnded = vi.fn();
    stop = watchForEndedSession(onEnded);
    await fetch(`${api}/patients/c1`, { headers: { Authorization: 'Bearer staff-token' } });
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("leaves other refusals to the page - a patient's wrong PIN must not sign the nurse out", async () => {
    respond(401, { error: 'Incorrect password' });
    const onEnded = vi.fn();
    stop = watchForEndedSession(onEnded);
    await fetch(`${api}/shared-history/approve`, { method: 'POST', headers: { Authorization: 'Bearer staff-token' } });
    expect(onEnded).not.toHaveBeenCalled();
  });

  it('ignores patient-portal requests, which use their own session', async () => {
    respond(401, { error: 'Unauthorized', reason: 'SESSION_ENDED' });
    const onEnded = vi.fn();
    stop = watchForEndedSession(onEnded);
    await fetch(`${api}/patient-portal/me`, { headers: { Authorization: 'Bearer patient-token' } });
    expect(onEnded).not.toHaveBeenCalled();
  });
});
