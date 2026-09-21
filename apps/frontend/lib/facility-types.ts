// The kinds of facility Bulamu supports. The values must match the
// FacilityType enum in apps/backend/prisma/schema.prisma - add a new type in
// both places (and here only once).
export const FACILITY_TYPES = [
  { value: 'CLINIC', label: 'Clinic' },
  { value: 'HEALTH_CENTRE_II', label: 'Health Centre II' },
  { value: 'HEALTH_CENTRE_III', label: 'Health Centre III' },
  { value: 'HEALTH_CENTRE_IV', label: 'Health Centre IV' },
  { value: 'HOSPITAL', label: 'Hospital' },
  { value: 'LABORATORY', label: 'Laboratory' },
  { value: 'IMAGING_CENTRE', label: 'Imaging Centre' },
  { value: 'PHARMACY', label: 'Pharmacy' },
  { value: 'COMMUNITY_OUTREACH', label: 'Community Outreach' },
  { value: 'MOBILE_UNIT', label: 'Mobile Unit' },
] as const;

export function facilityTypeLabel(value: string): string {
  return FACILITY_TYPES.find((type) => type.value === value)?.label ?? value.replaceAll('_', ' ');
}
