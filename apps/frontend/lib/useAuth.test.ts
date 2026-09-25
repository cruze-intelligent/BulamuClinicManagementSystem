import { beforeEach, describe, expect, it } from 'vitest';
import { getHomePath, useAuth } from './useAuth';

const signIn = (user: Record<string, unknown>) => localStorage.setItem('user', JSON.stringify(user));

describe('useAuth', () => {
  beforeEach(() => localStorage.clear());

  // Pages list `user` / `hasRole` in useEffect dependency arrays. If a new object
  // or function came back on every call, every render would re-run those effects:
  // the page would refetch forever and sit on "Loading...".
  it('returns the same user and the same hasRole on every call while the login is unchanged', () => {
    signIn({ id: 'u1', role: 'ADMIN', clinicId: 'c1', name: 'Amina' });

    const first = useAuth();
    const second = useAuth();
    const third = useAuth();

    expect(second.user).toBe(first.user);
    expect(third.user).toBe(first.user);
    expect(second.hasRole).toBe(first.hasRole);
    expect(third).toBe(first);
  });

  it('gives a new user only when the login actually changes', () => {
    signIn({ id: 'u1', role: 'ADMIN', clinicId: 'c1', name: 'Amina' });
    const before = useAuth();

    signIn({ id: 'u2', role: 'NURSE', clinicId: 'c1', name: 'Brian' });
    const after = useAuth();

    expect(after.user).not.toBe(before.user);
    expect(after.user?.id).toBe('u2');
    expect(after.hasRole('NURSE')).toBe(true);
    expect(after.hasRole('ADMIN')).toBe(false);
    expect(useAuth()).toBe(after);
  });

  it('checks roles against the signed-in user', () => {
    signIn({ id: 'u1', role: 'PHARMACIST', clinicId: 'c1', name: 'Carol' });
    const { hasRole } = useAuth();
    expect(hasRole('PHARMACIST')).toBe(true);
    expect(hasRole('ADMIN', 'PHARMACIST')).toBe(true);
    expect(hasRole('ADMIN', 'DOCTOR')).toBe(false);
  });

  it('is signed out - and stays the same object - when nobody is logged in or the stored login is unreadable', () => {
    const none = useAuth();
    expect(none.user).toBeNull();
    expect(none.hasRole('ADMIN')).toBe(false);
    expect(useAuth()).toBe(none);

    localStorage.setItem('user', '{not json');
    const broken = useAuth();
    expect(broken.user).toBeNull();
    expect(useAuth()).toBe(broken);
  });

  it('sends each role to its own home page', () => {
    expect(getHomePath({ role: 'SUPER_ADMIN' })).toBe('/super-admin');
    expect(getHomePath({ role: 'DOCTOR' })).toBe('/dashboard');
    expect(getHomePath(null)).toBe('/');
  });
});
