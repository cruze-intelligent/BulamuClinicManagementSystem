// Single source of truth for how a role is displayed. SUPER_ADMIN and ADMIN
// intentionally share the same label - end users only ever see "Admin".
const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Admin',
  ADMIN: 'Admin',
  DOCTOR: 'Doctor',
  NURSE: 'Nurse',
  PHARMACIST: 'Pharmacist',
  STAFF: 'Front Desk',
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] || role;
}
