import {
  ArrowRightLeft, BarChart3, BedDouble, Bell, Building2, CalendarDays, ClipboardList, CreditCard, Crown, FileCheck2, FileText, FlaskConical, HelpCircle,
  History, Home, MapPinned, MessageSquare, Package, Pill, Receipt, ScanLine, Stethoscope, Users, Wallet, type LucideIcon,
} from 'lucide-react';

// The sidebar menu: what each role sees. The guided walkthrough points at these
// items (data-tour="nav-<path>"), so a test checks the two stay in step.
export type NavItem = { name: string; path: string; icon: LucideIcon; roles: string[] };

export const NAV_ITEMS: NavItem[] = [
  { name: 'Facility Management', path: '/super-admin', icon: Crown, roles: ['SUPER_ADMIN'] },
  { name: 'Analytics', path: '/super-admin/analytics', icon: BarChart3, roles: ['SUPER_ADMIN'] },
  { name: 'Finances', path: '/super-admin/finances', icon: Wallet, roles: ['SUPER_ADMIN'] },
  { name: 'Demos', path: '/super-admin/demos', icon: FlaskConical, roles: ['SUPER_ADMIN'] },
  { name: 'Support messages', path: '/super-admin/messages', icon: MessageSquare, roles: ['SUPER_ADMIN'] },
  { name: 'Dashboard', path: '/dashboard', icon: Home, roles: ['ADMIN', 'DOCTOR', 'PHARMACIST', 'NURSE', 'STAFF', 'LAB_TECH', 'RADIOGRAPHER'] },
  { name: 'Messages', path: '/messages', icon: MessageSquare, roles: ['ADMIN', 'DOCTOR', 'PHARMACIST', 'NURSE', 'STAFF', 'LAB_TECH', 'RADIOGRAPHER'] },
  { name: 'Patients', path: '/patients', icon: Users, roles: ['ADMIN', 'DOCTOR', 'PHARMACIST', 'NURSE', 'STAFF', 'LAB_TECH', 'RADIOGRAPHER'] },
  { name: 'Appointments', path: '/appointments', icon: CalendarDays, roles: ['ADMIN', 'DOCTOR', 'NURSE', 'STAFF'] },
  { name: 'Consultations', path: '/consultations', icon: Stethoscope, roles: ['ADMIN', 'DOCTOR', 'NURSE', 'PHARMACIST'] },
  { name: 'Lab Tests', path: '/lab', icon: FlaskConical, roles: ['ADMIN', 'DOCTOR', 'NURSE', 'LAB_TECH'] },
  { name: 'Imaging', path: '/imaging', icon: ScanLine, roles: ['ADMIN', 'DOCTOR', 'NURSE', 'RADIOGRAPHER'] },
  { name: 'Results', path: '/results', icon: FileCheck2, roles: ['ADMIN', 'DOCTOR', 'NURSE', 'LAB_TECH', 'RADIOGRAPHER'] },
  { name: 'Wards', path: '/wards', icon: BedDouble, roles: ['ADMIN', 'DOCTOR', 'NURSE'] },
  { name: 'Clinical summary', path: '/summary', icon: FileText, roles: ['ADMIN', 'DOCTOR', 'NURSE'] },
  { name: 'Referrals', path: '/referrals', icon: ArrowRightLeft, roles: ['ADMIN', 'DOCTOR', 'NURSE', 'STAFF'] },
  { name: 'Household Visit', path: '/chw-visit', icon: MapPinned, roles: ['NURSE', 'STAFF'] },
  { name: 'Inventory', path: '/inventory', icon: Package, roles: ['ADMIN', 'PHARMACIST'] },
  { name: 'Dispensing', path: '/dispensing', icon: Pill, roles: ['ADMIN', 'PHARMACIST'] },
  { name: 'Bills & Payments', path: '/invoices', icon: Receipt, roles: ['ADMIN', 'DOCTOR', 'NURSE', 'STAFF', 'PHARMACIST'] },
  { name: 'Finances', path: '/finances', icon: Wallet, roles: ['ADMIN'] },
  { name: 'Reports', path: '/reports', icon: BarChart3, roles: ['ADMIN', 'SUPER_ADMIN'] },
  { name: 'Notifications', path: '/notifications', icon: Bell, roles: ['ADMIN', 'DOCTOR', 'PHARMACIST', 'NURSE', 'STAFF', 'LAB_TECH', 'RADIOGRAPHER'] },
  { name: 'Activity', path: '/sync-activity', icon: History, roles: ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'PHARMACIST', 'NURSE', 'STAFF', 'LAB_TECH', 'RADIOGRAPHER'] },
  { name: 'Staff', path: '/users', icon: ClipboardList, roles: ['ADMIN'] },
  { name: 'Facility', path: '/facility', icon: Building2, roles: ['ADMIN'] },
  { name: 'Billing', path: '/billing', icon: CreditCard, roles: ['ADMIN'] },
  { name: 'Help & FAQ', path: '/help', icon: HelpCircle, roles: ['SUPER_ADMIN', 'ADMIN', 'DOCTOR', 'PHARMACIST', 'NURSE', 'STAFF', 'LAB_TECH', 'RADIOGRAPHER'] },
];

/** In everyone's menu, whatever the administrator leaves out. */
export const ALWAYS_SHOWN = ['/dashboard', '/notifications', '/help'];

/**
 * The menu for a person: what their roles (their own and any others they also
 * work in) give them, less the parts the administrator has left out for them.
 */
export function menuFor(roles: string[], hiddenSections: string[] = []): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.some((r) => roles.includes(r)) && (ALWAYS_SHOWN.includes(item.path) || !hiddenSections.includes(item.path)));
}
