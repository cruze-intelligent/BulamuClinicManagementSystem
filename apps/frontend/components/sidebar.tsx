'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/useAuth';

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, hasRole } = useAuth();

  if (!user) return null;

  const isActive = (path: string) => pathname === path;

  const handleLogout = () => {
    localStorage.clear();
    router.push('/');
  };

  const navItems = [
    { name: 'Dashboard', path: '/dashboard', icon: '📊', roles: ['ADMIN', 'DOCTOR', 'NURSE', 'STAFF'] },
    { name: 'Patients', path: '/patients', icon: '👥', roles: ['ADMIN', 'DOCTOR', 'NURSE', 'STAFF'] },
    { name: 'Appointments', path: '/appointments', icon: '📅', roles: ['ADMIN', 'DOCTOR', 'NURSE', 'STAFF'] },
    { name: 'Consultations', path: '/consultations', icon: '💊', roles: ['ADMIN', 'DOCTOR', 'NURSE'] },
    { name: 'Lab Tests', path: '/lab', icon: '🔬', roles: ['ADMIN', 'DOCTOR', 'NURSE'] },
    { name: 'Inventory', path: '/inventory', icon: '💊', roles: ['ADMIN', 'DOCTOR', 'NURSE'] },
    { name: 'Invoices', path: '/invoices', icon: '💰', roles: ['ADMIN', 'DOCTOR'] },
    { name: 'Reports', path: '/reports', icon: '📈', roles: ['ADMIN', 'DOCTOR'] },
    { name: 'Staff', path: '/users', icon: '👔', roles: ['ADMIN'] },
  ];

  const filteredNavItems = navItems.filter(item => hasRole(...item.roles));

  return (
    <div className="fixed left-0 top-0 h-screen w-64 bg-white border-r border-slate-200 flex flex-col">
      {/* Header - Fixed */}
      <div className="p-6 border-b border-slate-200">
        <h1 className="text-2xl font-bold text-slate-800">Bulamu 🏥</h1>
        <p className="text-sm text-slate-500 mt-1">{user.name}</p>
        <p className="text-xs text-slate-400">{user.role}</p>
      </div>

      {/* Navigation - Scrollable */}
      <nav className="flex-1 overflow-y-auto p-4 space-y-2">
        {filteredNavItems.map((item) => (
          <Link
            key={item.path}
            href={item.path}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
              isActive(item.path)
                ? 'bg-blue-50 text-blue-600 font-medium'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <span className="text-xl">{item.icon}</span>
            <span>{item.name}</span>
          </Link>
        ))}
      </nav>

      {/* Logout - Fixed at bottom */}
      <div className="p-4 border-t border-slate-200">
        <button
          onClick={handleLogout}
          className="w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
        >
          Logout 🚪
        </button>
      </div>
    </div>
  );
}