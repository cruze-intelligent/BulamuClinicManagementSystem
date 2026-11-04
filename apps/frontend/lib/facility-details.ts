import { facilityTypeLabel } from '@/lib/facility-types';
import { shortDate } from '@/lib/finance';

// The facility details its administrator keeps up to date. The rules match
// apps/backend/src/lib/facility-details.ts, which has the final say.
export const DETAIL_FIELDS = ['name', 'facilityType', 'phone', 'address', 'district', 'subCounty', 'parish'] as const;
export type DetailField = (typeof DETAIL_FIELDS)[number];
export type FacilityDetails = Record<DetailField, string | null>;
export type DetailForm = Record<DetailField, string>;

export const DETAIL_LABELS: Record<DetailField, string> = {
  name: 'Name', facilityType: 'Type', phone: 'Phone', address: 'Address', district: 'District', subCounty: 'Sub-county', parish: 'Parish',
};

export type Allowance = { limit: number; windowDays: number; used: number; remaining: number; nextFreeAt: string | null };
export type DetailChange = {
  id: string;
  status: 'APPLIED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
  changes: Partial<Record<DetailField, { from: string | null; to: string | null }>>;
  note: string | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  requestedByUser: { name: string } | null;
  reviewedByUser: { name: string } | null;
};

export const STATUS_LABELS: Record<DetailChange['status'], string> = {
  APPLIED: 'Made by your facility',
  PENDING: 'Waiting for Bulamu',
  APPROVED: 'Approved by Bulamu',
  REJECTED: 'Not made - turned down by Bulamu',
  WITHDRAWN: 'Withdrawn',
};

const tidy = (value: string) => value.trim().replace(/\s+/g, ' ');

export const formFrom = (details: FacilityDetails): DetailForm =>
  Object.fromEntries(DETAIL_FIELDS.map((field) => [field, details[field] ?? ''])) as DetailForm;

/** Only the fields that differ from the details on file, tidied as the server will store them. */
export function detailEdits(form: DetailForm, current: FacilityDetails): Partial<Record<DetailField, string>> {
  const edits: Partial<Record<DetailField, string>> = {};
  for (const field of DETAIL_FIELDS) {
    const value = tidy(form[field]);
    if (value !== (current[field] ?? '')) edits[field] = value;
  }
  return edits;
}

/** What is wrong with the form, in the words the person sees - or null. */
export function detailProblem(form: DetailForm): string | null {
  const name = tidy(form.name);
  if (!name) return 'Enter the facility name';
  if (name.length < 3) return 'The name must be at least 3 characters';
  if (!tidy(form.address)) return 'Enter the address';
  const phone = tidy(form.phone);
  const digits = phone.replace(/\D/g, '').length;
  if (!phone) return 'Enter the phone number';
  if (!/^[+\d\s()-]+$/.test(phone) || digits < 9 || digits > 15) return 'Enter a phone number of 9 to 15 digits, such as 0772 123456';
  return null;
}

export const shownValue = (field: DetailField, value: string | null | undefined) =>
  !value ? '(none)' : field === 'facilityType' ? facilityTypeLabel(value) : value;

/** [label, from, to] for each field a change touches. */
export const changeRows = (change: Pick<DetailChange, 'changes'>): Array<[string, string, string]> =>
  DETAIL_FIELDS.filter((field) => change.changes[field]).map((field) => [
    DETAIL_LABELS[field], shownValue(field, change.changes[field]!.from), shownValue(field, change.changes[field]!.to),
  ]);

/** How many changes are left and what happens after; in the form it also asks for the reason. */
export function allowanceText(allowance: Allowance, inForm = true): string {
  const { remaining, limit } = allowance;
  if (remaining > 0) {
    const times = remaining === 1 ? '1 more change' : `${remaining} more changes`;
    return `You can make ${times} yourself in the next 12 months. Beyond ${limit} changes in 12 months, Bulamu checks each change before it is made.`;
  }
  const until = allowance.nextFreeAt ? ` until ${shortDate(allowance.nextFreeAt)}` : '';
  return `Your facility has changed its details ${limit} times in the last 12 months, so Bulamu checks each further change${until}.${inForm ? ' Say why the details are changing.' : ''}`;
}
