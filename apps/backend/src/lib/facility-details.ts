import { FacilityType, Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { facilityTypeLabel, normalizePhoneKey } from './facility';

// A facility's administrator keeps its details up to date themselves: up to
// SELF_SERVICE_CHANGES changes in any ALLOWANCE_DAYS apply at once. Past that,
// each further change waits for a Bulamu administrator to check it, so a
// facility's identity on its documents and referrals can't keep shifting
// unchecked.
export const SELF_SERVICE_CHANGES = 3;
export const ALLOWANCE_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

export const DETAIL_FIELDS = ['name', 'facilityType', 'phone', 'address', 'district', 'subCounty', 'parish'] as const;
export type DetailField = (typeof DETAIL_FIELDS)[number];

export const DETAIL_LABELS: Record<DetailField, string> = {
  name: 'Name',
  facilityType: 'Type',
  phone: 'Phone',
  address: 'Address',
  district: 'District',
  subCounty: 'Sub-county',
  parish: 'Parish',
};

const REQUIRED: DetailField[] = ['name', 'facilityType', 'phone', 'address'];
const MAX_LENGTH: Record<DetailField, number> = { name: 120, facilityType: 40, phone: 30, address: 300, district: 80, subCounty: 80, parish: 80 };

export type FacilityDetails = Record<DetailField, string | null>;
export type DetailChanges = Partial<Record<DetailField, { from: string | null; to: string | null }>>;

export class FacilityDetailsError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export const DETAIL_SELECT = { name: true, facilityType: true, phone: true, address: true, district: true, subCounty: true, parish: true } as const;

/** One field as it is shown to people: the type's label, "(none)" for blank. */
export function displayValue(field: DetailField, value: string | null): string {
  if (!value) return '(none)';
  return field === 'facilityType' ? facilityTypeLabel(value) : value;
}

/**
 * Checks what the administrator typed against the facility's current details
 * and returns only the fields that actually change. Fields left out of the
 * body stay as they are.
 */
export function parseDetailEdits(body: unknown, current: FacilityDetails): DetailChanges {
  if (!body || typeof body !== 'object') throw new FacilityDetailsError(400, 'Send the details to change');
  const input = body as Record<string, unknown>;
  const changes: DetailChanges = {};

  for (const field of DETAIL_FIELDS) {
    if (!(field in input)) continue;
    const raw = input[field];
    if (raw !== null && raw !== undefined && typeof raw !== 'string') throw new FacilityDetailsError(400, `${DETAIL_LABELS[field]} must be text`);
    const value = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';

    if (!value) {
      if (REQUIRED.includes(field)) throw new FacilityDetailsError(400, `${DETAIL_LABELS[field]} can not be left empty`);
    } else if (value.length > MAX_LENGTH[field]) {
      throw new FacilityDetailsError(400, `${DETAIL_LABELS[field]} must be at most ${MAX_LENGTH[field]} characters`);
    }
    if (field === 'name' && value.length < 3) throw new FacilityDetailsError(400, 'Name must be at least 3 characters');
    if (field === 'facilityType' && !Object.values(FacilityType).includes(value as FacilityType)) {
      throw new FacilityDetailsError(400, 'Choose a facility type from the list');
    }
    if (field === 'phone' && (!/^[+\d\s()-]+$/.test(value) || value.replace(/\D/g, '').length < 9 || value.replace(/\D/g, '').length > 15)) {
      throw new FacilityDetailsError(400, 'Enter a phone number of 9 to 15 digits, such as 0772 123456 or +256 772 123456');
    }

    const next = value || null;
    if (next !== (current[field] ?? null)) changes[field] = { from: current[field] ?? null, to: next };
  }

  if (Object.keys(changes).length === 0) throw new FacilityDetailsError(400, 'Nothing has changed - these are already the facility details');
  return changes;
}

/** How many changes the facility may still make itself, and when the next one frees up. */
export async function changeAllowance(tx: Prisma.TransactionClient, clinicId: string, now = new Date()) {
  const since = new Date(now.getTime() - ALLOWANCE_DAYS * DAY_MS);
  const counted = await tx.facilityDetailChange.findMany({
    where: { clinicId, status: 'APPLIED', createdAt: { gt: since } },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });
  const used = counted.length;
  const remaining = Math.max(0, SELF_SERVICE_CHANGES - used);
  // When the oldest counted change ages out, one more can be made directly.
  const nextFreeAt = remaining === 0 && counted.length ? new Date(counted[used - SELF_SERVICE_CHANGES].createdAt.getTime() + ALLOWANCE_DAYS * DAY_MS) : null;
  return { limit: SELF_SERVICE_CHANGES, windowDays: ALLOWANCE_DAYS, used, remaining, nextFreeAt };
}

const lockClinic = (tx: Prisma.TransactionClient, clinicId: string) =>
  tx.$queryRaw`SELECT id FROM "Clinic" WHERE id = ${clinicId} FOR UPDATE`;

/** Writes the new values onto the facility, refusing a phone number another facility already uses. */
async function applyChanges(tx: Prisma.TransactionClient, clinicId: string, changes: DetailChanges) {
  const data: Prisma.ClinicUpdateInput = {};
  for (const [field, change] of Object.entries(changes) as Array<[DetailField, { to: string | null }]>) {
    (data as Record<string, unknown>)[field] = change.to;
  }
  if (changes.phone?.to) {
    const phoneKey = normalizePhoneKey(changes.phone.to);
    const other = await tx.clinic.findFirst({
      where: { phoneKey, id: { not: clinicId }, deletedAt: null, registrationStatus: { in: ['PENDING', 'APPROVED'] } },
      select: { facilityCode: true },
    });
    if (other) throw new FacilityDetailsError(409, `Another facility on Bulamu already uses this phone number (Facility ID ${other.facilityCode}). Use the facility's own number, or contact Bulamu support.`);
    data.phoneKey = phoneKey;
  }
  return tx.clinic.update({ where: { id: clinicId }, data, select: { id: true, facilityCode: true, ...DETAIL_SELECT } });
}

const cleanNote = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 500) : null;

/**
 * A facility administrator's change to the facility details: made at once
 * while the allowance lasts, otherwise kept for a Bulamu administrator to
 * review. Only one change may wait for review at a time.
 */
export async function requestDetailChange(input: { clinicId: string; userId: string; body: unknown; now?: Date }) {
  const now = input.now ?? new Date();
  const note = cleanNote((input.body as Record<string, unknown> | null)?.note);
  return prisma.$transaction(async (tx) => {
    await lockClinic(tx, input.clinicId);
    const clinic = await tx.clinic.findUnique({ where: { id: input.clinicId }, select: { isDemo: true, deletedAt: true, ...DETAIL_SELECT } });
    if (!clinic || clinic.deletedAt) throw new FacilityDetailsError(404, 'Facility not found');

    const pending = await tx.facilityDetailChange.findFirst({ where: { clinicId: input.clinicId, status: 'PENDING' }, select: { id: true } });
    if (pending) throw new FacilityDetailsError(409, 'A change to the facility details is already waiting for Bulamu to review it. Withdraw it first to send a different one.');

    const changes = parseDetailEdits(input.body, clinic);
    const allowance = await changeAllowance(tx, input.clinicId, now);

    if (allowance.remaining > 0) {
      const updated = await applyChanges(tx, input.clinicId, changes);
      const change = await tx.facilityDetailChange.create({
        data: { clinicId: input.clinicId, changes, status: 'APPLIED', note, requestedBy: input.userId, createdAt: now },
      });
      return { outcome: 'APPLIED' as const, change, clinic: updated, allowance: { ...allowance, used: allowance.used + 1, remaining: allowance.remaining - 1 } };
    }

    if (clinic.isDemo) {
      throw new FacilityDetailsError(400, `This is a demonstration facility, so its details can be changed ${SELF_SERVICE_CHANGES} times. At a real facility, further changes go to Bulamu for review.`);
    }
    if (!note) {
      throw new FacilityDetailsError(400, `Your facility has already changed its details ${SELF_SERVICE_CHANGES} times in the last 12 months, so this change will be reviewed by Bulamu. Say briefly why the details are changing.`);
    }
    const change = await tx.facilityDetailChange.create({
      data: { clinicId: input.clinicId, changes, status: 'PENDING', note, requestedBy: input.userId, createdAt: now },
    });
    return { outcome: 'PENDING' as const, change, clinic: { id: input.clinicId, ...detailsOf(clinic) }, allowance };
  }, { timeout: 15000 });
}

const detailsOf = (clinic: FacilityDetails): FacilityDetails => ({
  name: clinic.name, facilityType: clinic.facilityType, phone: clinic.phone, address: clinic.address,
  district: clinic.district, subCounty: clinic.subCounty, parish: clinic.parish,
});

/** The facility takes back its change before Bulamu has looked at it. */
export async function withdrawDetailChange(clinicId: string, userId: string) {
  const pending = await prisma.facilityDetailChange.findFirst({ where: { clinicId, status: 'PENDING' } });
  if (!pending) throw new FacilityDetailsError(404, 'There is no change waiting for review');
  return prisma.facilityDetailChange.update({
    where: { id: pending.id },
    data: { status: 'WITHDRAWN', reviewedBy: userId, reviewedAt: new Date() },
  });
}

/** A Bulamu administrator approves (and so makes) or rejects a change waiting for review. */
export async function reviewDetailChange(input: { id: string; reviewerId: string; approve: boolean; note?: unknown }) {
  const reviewNote = cleanNote(input.note);
  if (!input.approve && !reviewNote) throw new FacilityDetailsError(400, 'Say why the change is not being made - the facility is told');
  return prisma.$transaction(async (tx) => {
    const found = await tx.facilityDetailChange.findUnique({ where: { id: input.id }, select: { clinicId: true } });
    if (!found) throw new FacilityDetailsError(404, 'Change not found');
    await lockClinic(tx, found.clinicId);
    const change = await tx.facilityDetailChange.findUniqueOrThrow({ where: { id: input.id } });
    if (change.status !== 'PENDING') throw new FacilityDetailsError(409, 'This change has already been dealt with');

    const clinic = input.approve ? await applyChanges(tx, change.clinicId, change.changes as DetailChanges) : null;
    const reviewed = await tx.facilityDetailChange.update({
      where: { id: change.id },
      data: { status: input.approve ? 'APPROVED' : 'REJECTED', reviewedBy: input.reviewerId, reviewedAt: new Date(), reviewNote },
    });
    return { change: reviewed, clinic };
  }, { timeout: 15000 });
}

/** [label, from, to] rows, for emails and the review screen. */
export function changeRows(changes: DetailChanges): Array<[string, string, string]> {
  return (Object.entries(changes) as Array<[DetailField, { from: string | null; to: string | null }]>)
    .filter(([field]) => DETAIL_FIELDS.includes(field))
    .map(([field, change]) => [DETAIL_LABELS[field], displayValue(field, change.from), displayValue(field, change.to)]);
}

/** A change as the app shows it, with the names of the people involved. */
export async function describeChanges<T extends { requestedBy: string; reviewedBy: string | null }>(rows: T[]) {
  const ids = [...new Set(rows.flatMap((row) => [row.requestedBy, row.reviewedBy]).filter((id): id is string => !!id))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true, role: true } }) : [];
  const byId = new Map(users.map((user) => [user.id, user]));
  return rows.map((row) => ({
    ...row,
    requestedByUser: byId.get(row.requestedBy) ?? null,
    reviewedByUser: row.reviewedBy ? byId.get(row.reviewedBy) ?? null : null,
  }));
}
