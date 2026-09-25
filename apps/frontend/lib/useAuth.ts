// SUPER_ADMIN lands on /super-admin (matching the login redirect); every
// other signed-in role lands on /dashboard; a signed-out visitor goes home.
export function getHomePath(user: { role?: string } | null): string {
  if (!user) return '/';
  return user.role === 'SUPER_ADMIN' ? '/super-admin' : '/dashboard';
}

type AuthUser = { id: string; role: string; clinicId: string; name: string; [key: string]: any } | null;
type Auth = { user: AuthUser; hasRole: (...roles: string[]) => boolean };

const SIGNED_OUT: Auth = { user: null, hasRole: () => false };

// The signed-in user lives in localStorage and is read on every call. If each
// call built a fresh object and a fresh hasRole function, any component listing
// them in a useEffect dependency array would re-run that effect on every render
// - refetching its data, changing state, and rendering again, forever (pages
// stuck on "Loading..." and the API hammered with the same request). So the
// result is cached against the stored text and only rebuilt when the login
// actually changes: the same `user` and `hasRole` come back render after render.
let cachedRaw: string | null | undefined;
let cached: Auth = SIGNED_OUT;

function parse(raw: string | null): AuthUser {
  try {
    return JSON.parse(raw || 'null');
  } catch {
    return null;
  }
}

export function useAuth(): Auth {
  if (typeof window === 'undefined') return SIGNED_OUT;

  const raw = localStorage.getItem('user');
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    const user = parse(raw);
    cached = {
      user,
      hasRole: (...roles: string[]) => (user ? roles.includes(user.role) : false),
    };
  }
  return cached;
}
