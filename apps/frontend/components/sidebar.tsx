'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  Crown,
  FlaskConical,
  HelpCircle,
  Home,
  LogOut,
  Package,
  Receipt,
  Search,
  ShieldCheck,
  Stethoscope,
  Users,
} from 'lucide-react';
import { useAuth } from '@/lib/useAuth';

const navItems = [
  { name: 'God Mode', path: '/super-admin', icon: Crown, roles: ['SUPER_ADMIN'] },
  { name: 'Dashboard', path: '/dashboard', icon: Home, roles: ['ADMIN', 'DOCTOR', 'PHARMACIST', 'NURSE', 'STAFF'] },
  { name: 'Patients', path: '/patients', icon: Users, roles: ['ADMIN', 'DOCTOR', 'PHARMACIST', 'NURSE', 'STAFF'] },
  { name: 'Appointments', path: '/appointments', icon: CalendarDays, roles: ['ADMIN', 'DOCTOR', 'NURSE', 'STAFF'] },
  { name: 'Consultations', path: '/consultations', icon: Stethoscope, roles: ['ADMIN', 'DOCTOR', 'PHARMACIST'] },
  { name: 'Lab Tests', path: '/lab', icon: FlaskConical, roles: ['ADMIN', 'DOCTOR', 'NURSE'] },
  { name: 'Inventory', path: '/inventory', icon: Package, roles: ['ADMIN', 'PHARMACIST'] },
  { name: 'Invoices', path: '/invoices', icon: Receipt, roles: ['ADMIN'] },
  { name: 'Reports', path: '/reports', icon: BarChart3, roles: ['ADMIN', 'SUPER_ADMIN'] },
  { name: 'Staff', path: '/users', icon: ClipboardList, roles: ['ADMIN'] },
  { name: 'Help & FAQ', path: '/help', icon: HelpCircle, roles: ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'PHARMACIST', 'NURSE', 'STAFF'] },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, hasRole } = useAuth();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !user) return null;

  const handleLogout = () => {
    localStorage.clear();
    router.push('/');
  };

  const filteredNavItems = navItems.filter((item) => hasRole(...item.roles));

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-5">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-md bg-emerald-700 text-white">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-950">Bulamu</h1>
            <p className="text-xs font-medium uppercase text-emerald-700">Medical Facility OS</p>
          </div>
        </div>
        <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="truncate text-sm font-semibold text-slate-900">{user.name}</p>
          <p className="mt-1 text-xs capitalize text-slate-500">{String(user.role).replace('_', ' ').toLowerCase()}</p>
        </div>
      </div>

      <div className="px-4 pt-4">
        <div className="flex min-h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500">
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">Search patients from dashboard</span>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-4">
        {filteredNavItems.map((item) => {
          const active = pathname === item.path;
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`flex min-h-10 items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors ${
                active
                  ? 'bg-emerald-50 font-semibold text-emerald-800'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
              }`}
            >
              <item.icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.name}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-200 p-4">
        <button
          onClick={handleLogout}
          className="flex min-h-10 w-full items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-50"
        >
          <LogOut className="size-4" aria-hidden="true" />
          Logout
        </button>
      </div>
    </aside>
  );
}
