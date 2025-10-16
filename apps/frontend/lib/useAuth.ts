export function useAuth() {
  if (typeof window === 'undefined') return { user: null, hasRole: () => false };
  
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  
  const hasRole = (...roles: string[]) => {
    if (!user) return false;
    return roles.includes(user.role);
  };

  return { user, hasRole };
}