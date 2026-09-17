// SUPER_ADMIN lands on /super-admin (matching the login redirect); every
// other signed-in role lands on /dashboard; a signed-out visitor goes home.
export function getHomePath(user: { role?: string } | null): string {
  if (!user) return '/';
  return user.role === 'SUPER_ADMIN' ? '/super-admin' : '/dashboard';
}

export function useAuth() {
  if (typeof window === 'undefined') return { user: null, hasRole: () => false };
  
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  
  const hasRole = (...roles: string[]) => {
    if (!user) return false;
    return roles.includes(user.role);
  };

  return { user, hasRole };
}