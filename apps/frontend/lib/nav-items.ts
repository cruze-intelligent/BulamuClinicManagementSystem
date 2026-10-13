import {
  ArrowRightLeft, BarChart3, BedDouble, Bell, Building2, CalendarDays, ClipboardList, CreditCard, Crown, FlaskConical, HelpCircle,
  History, Home, MapPinned, Package, Pill, Receipt, Stethoscope, Users, type LucideIcon,
} from 'lucide-react';

// The sidebar menu: what each role sees. The guided walkthrough points at these
// items (data-tour="nav-<path>"), so a test checks the two stay in step.
export type NavItem = { name: string; path: string; icon: LucideIcon; roles: string[] };

export const NAV_ITEMS: NavItem[] = [
  { name: 'Facility Management', path: '/super-admin', icon: Crown, roles: ['SUPER_ADMIN'] },
  { name: 'Analytics', path: '/super-admin/analytics', icon: BarChart3, roles: ['SUPER_ADMIN'] },
  { name: 'Dashboard', path: '/dashboard', icon: Home, roles: ['ADMIN', 'DOCTOR', 'PHARMACIST', 'NURSE', 'STAFF'] },
  { name: 'Patients', path: '/patients', icon: Users, roles: ['ADMIN', 'DOCTOR', 'PHARMACIST', 'NURSE', 'STAFF'] },
  { name: 'Appointments', path: '/appointments', icon: CalendarDays, roles: ['ADMIN', 'DOCTOR', 'NURSE', 'STAFF'] },
  { name: 'Consultations', path: '/consultations', icon: Stethoscope, roles: ['ADMIN', 'DOCTOR', 'PHARMACIST'] },
  { name: 'Lab Tests', path: '/lab', icon: FlaskConical, roles: ['ADMIN', 'DOCTOR', 'NURSE'] },
  { name: 'Wards', path: '/wards', icon: BedDouble, roles: ['ADMIN', 'DOCTOR', 'NURSE'] },
  { name: 'Referrals', path: '/referrals', icon: ArrowRightLeft, roles: ['ADMIN', 'DOCTOR', 'NURSE', 'STAFF'] },
  { name: 'Household Visit', path: '/chw-visit', icon: MapPinned, roles: ['NURSE', 'STAFF'] },
  { name: 'Inventory', path: '/inventory', icon: Package, roles: ['ADMIN', 'PHARMACIST'] },
  { name: 'Dispensing', path: '/dispensing', icon: Pill, roles: ['ADMIN', 'PHARMACIST'] },
  { name: 'Invoices', path: '/invoices', icon: Receipt, roles: ['ADMIN'] },
  { name: 'Reports', path: '/reports', icon: BarChart3, roles: ['ADMIN', 'SUPER_ADMIN'] },
  { name: 'Notifications', path: '/notifications', icon: Bell, roles: ['ADMIN', 'DOCTOR', 'PHARMACIST', 'NURSE', 'STAFF'] },
  { name: 'Activity', path: '/sync-activity', icon: History, roles: ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'PHARMACIST', 'NURSE', 'STAFF'] },
  { name: 'Staff', path: '/users', icon: ClipboardList, roles: ['ADMIN'] },
  { name: 'Facility', path: '/facility', icon: Building2, roles: ['ADMIN'] },
  { name: 'Billing', path: '/billing', icon: CreditCard, roles: ['ADMIN'] },
  { name: 'Help & FAQ', path: '/help', icon: HelpCircle, roles: ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'PHARMACIST', 'NURSE', 'STAFF'] },
];
