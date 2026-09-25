import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { eastAfricaDay } from './usage-tracking';

/**
 * Platform analytics for the super admin.
 *
 * Everything here is a COUNT or a timestamp about how the platform is used -
 * facilities, staff, records created, sign-ins, revenue. It deliberately reads no
 * clinical content (no diagnoses, medicines, names of patients): a facility's
 * clinical data is the facility's, and the operator's view of it stops at "how
 * much is being recorded", not "what".
 *
 * Days are East Africa Time (UTC+3) calendar days, because that is the users' own
 * "today".
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const EAT = '+03:00';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export type Range = {
  days: number;
  fromDay: string; // first day of the period, YYYY-MM-DD (EAT)
  toDay: string;   // last day of the period (today, EAT)
  fromTs: Date;    // start of fromDay in EAT
  toTs: Date;      // start of the day AFTER toDay in EAT (exclusive end)
  prevFromTs: Date; // start of the equally long period before this one
};

const addDays = (day: string, n: number) => new Date(new Date(`${day}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);

/** The period ending today (EAT) and lasting `days` days, plus where the previous one began. */
export function periodRange(days: number, now: Date = new Date()): Range {
  const toDay = eastAfricaDay(now);
  const fromDay = addDays(toDay, -(days - 1));
  return {
    days,
    fromDay,
    toDay,
    fromTs: new Date(`${fromDay}T00:00:00${EAT}`),
    toTs: new Date(`${addDays(toDay, 1)}T00:00:00${EAT}`),
    prevFromTs: new Date(`${addDays(fromDay, -days)}T00:00:00${EAT}`),
  };
}

/** Only 7, 30 or 90 day windows are offered; anything else falls back to 30. */
export function parseDays(value: unknown): number {
  const n = Number(value);
  return n === 7 || n === 30 || n === 90 ? n : 30;
}

export type Engagement = 'ACTIVE' | 'QUIET' | 'DORMANT' | 'NEW' | 'NEVER_USED';

/**
 * How engaged a facility is, from the last time anything happened there: active
 * within the last week, quiet within the month, dormant beyond that. A facility
 * with no activity at all is NEW if it only just joined, NEVER_USED if it has been
 * around longer than a week and still has nothing.
 */
export function engagementStatus(lastActivityAt: Date | null, createdAt: Date, now: Date = new Date()): Engagement {
  if (!lastActivityAt) return now.getTime() - createdAt.getTime() <= 7 * DAY_MS ? 'NEW' : 'NEVER_USED';
  const age = now.getTime() - lastActivityAt.getTime();
  if (age <= 7 * DAY_MS) return 'ACTIVE';
  if (age <= 30 * DAY_MS) return 'QUIET';
  return 'DORMANT';
}

/** Change from the previous period as a fraction (0.25 = up 25%); null when there is no baseline. */
export function changeFrom(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}

const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);

// ---------------------------------------------------------------------------
// Query building blocks
// ---------------------------------------------------------------------------

type Point = { date: string; value: number };

/** A count per EAT day over the period, zero-filled so quiet days still appear. */
async function dailyCounts(table: string, column: string, range: Range, extraWhere: Prisma.Sql = Prisma.empty): Promise<Point[]> {
  const col = Prisma.raw(`"${column}"`);
  const rows = await prisma.$queryRaw<Array<{ day: string; n: number }>>(Prisma.sql`
    SELECT to_char(d::date, 'YYYY-MM-DD') AS day, COALESCE(c.n, 0)::int AS n
    FROM generate_series(${range.fromDay}::date, ${range.toDay}::date, interval '1 day') AS d
    LEFT JOIN (
      SELECT ((${col} + interval '3 hours')::date) AS day, count(*)::int AS n
      FROM ${Prisma.raw(`"${table}"`)}
      WHERE ${col} >= ${range.fromTs} AND ${col} < ${range.toTs} ${extraWhere}
      GROUP BY 1
    ) c ON c.day = d::date
    ORDER BY d
  `);
  return rows.map((r) => ({ date: r.day, value: r.n }));
}

async function countBetween(table: string, column: string, from: Date, to: Date, extraWhere: Prisma.Sql = Prisma.empty): Promise<number> {
  const col = Prisma.raw(`"${column}"`);
  const rows = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
    SELECT count(*)::int AS n FROM ${Prisma.raw(`"${table}"`)} WHERE ${col} >= ${from} AND ${col} < ${to} ${extraWhere}
  `);
  return rows[0]?.n ?? 0;
}

const notDeleted = Prisma.sql`AND "deletedAt" IS NULL`;
const staffOnly = Prisma.sql`u."role" <> 'SUPER_ADMIN'`;

/** Distinct staff active on each EAT day (platform operators excluded). */
async function activeUsersByDay(range: Range): Promise<Point[]> {
  const rows = await prisma.$queryRaw<Array<{ day: string; n: number }>>(Prisma.sql`
    SELECT to_char(d::date, 'YYYY-MM-DD') AS day, COALESCE(c.n, 0)::int AS n
    FROM generate_series(${range.fromDay}::date, ${range.toDay}::date, interval '1 day') AS d
    LEFT JOIN (
      SELECT a."day" AS day, count(DISTINCT a."userId")::int AS n
      FROM "UserActivityDay" a JOIN "User" u ON u."id" = a."userId"
      WHERE a."day" >= ${range.fromDay}::date AND a."day" <= ${range.toDay}::date AND ${staffOnly}
      GROUP BY 1
    ) c ON c.day = d::date
    ORDER BY d
  `);
  return rows.map((r) => ({ date: r.day, value: r.n }));
}

async function distinctActiveUsersSince(fromDay: string, toDay: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
    SELECT count(DISTINCT a."userId")::int AS n
    FROM "UserActivityDay" a JOIN "User" u ON u."id" = a."userId"
    WHERE a."day" >= ${fromDay}::date AND a."day" <= ${toDay}::date AND ${staffOnly}
  `);
  return rows[0]?.n ?? 0;
}

async function loginsByDay(range: Range, outcomes: string[]): Promise<Point[]> {
  const rows = await prisma.$queryRaw<Array<{ day: string; n: number }>>(Prisma.sql`
    SELECT to_char(d::date, 'YYYY-MM-DD') AS day, COALESCE(c.n, 0)::int AS n
    FROM generate_series(${range.fromDay}::date, ${range.toDay}::date, interval '1 day') AS d
    LEFT JOIN (
      SELECT ((e."createdAt" + interval '3 hours')::date) AS day, count(*)::int AS n
      FROM "LoginEvent" e
      WHERE e."createdAt" >= ${range.fromTs} AND e."createdAt" < ${range.toTs}
        AND e."outcome"::text IN (${Prisma.join(outcomes)})
      GROUP BY 1
    ) c ON c.day = d::date
    ORDER BY d
  `);
  return rows.map((r) => ({ date: r.day, value: r.n }));
}

const sum = (points: Point[]) => points.reduce((a, p) => a + p.value, 0);

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/** Facilities that count in the analytics: real, approved ones - not the operator's own account. */
const realFacility = { deletedAt: null, users: { none: { role: 'SUPER_ADMIN' as const } } };

export async function buildAnalytics(days: number, now: Date = new Date()) {
  const range = periodRange(days, now);
  const wauFrom = addDays(range.toDay, -6);
  const mauFrom = addDays(range.toDay, -29);

  const [
    clinicsByStatus, subscriptions, staffByRole, staffTotal,
    patientsTotal, patientsNew, patientsNewPrev,
    consultationsCount, consultationsPrev,
    registrationsCount, registrationsPrev,
    revenueNow, revenuePrev, mrr,
    dau, wau, mau,
    activeSeries, newPatientsSeries, consultationsSeries, appointmentsSeries, registrationsSeries, loginsSeries, failedLoginsSeries,
    activeByRole,
    typeCounts, districtCounts,
    trackingBounds,
  ] = await Promise.all([
    prisma.clinic.groupBy({ by: ['registrationStatus', 'isActive'], where: { deletedAt: null, users: { none: { role: 'SUPER_ADMIN' } } }, _count: true }),
    prisma.subscription.groupBy({ by: ['status', 'plan'], where: { clinic: { is: realFacility } }, _count: true }),
    prisma.user.groupBy({ by: ['role'], where: { role: { not: 'SUPER_ADMIN' }, isActive: true, clinic: { is: realFacility } }, _count: true }),
    prisma.user.count({ where: { role: { not: 'SUPER_ADMIN' }, clinic: { is: realFacility } } }),
    prisma.patient.count({ where: { deletedAt: null, clinic: { is: realFacility } } }),
    countBetween('Patient', 'createdAt', range.fromTs, range.toTs, notDeleted),
    countBetween('Patient', 'createdAt', range.prevFromTs, range.fromTs, notDeleted),
    countBetween('Consultation', 'createdAt', range.fromTs, range.toTs, notDeleted),
    countBetween('Consultation', 'createdAt', range.prevFromTs, range.fromTs, notDeleted),
    countBetween('Clinic', 'createdAt', range.fromTs, range.toTs, notDeleted),
    countBetween('Clinic', 'createdAt', range.prevFromTs, range.fromTs, notDeleted),
    prisma.payment.aggregate({ where: { status: 'COMPLETED', amount: { gt: 0 }, updatedAt: { gte: range.fromTs, lt: range.toTs } }, _sum: { amount: true }, _count: true }),
    prisma.payment.aggregate({ where: { status: 'COMPLETED', amount: { gt: 0 }, updatedAt: { gte: range.prevFromTs, lt: range.fromTs } }, _sum: { amount: true } }),
    prisma.subscription.aggregate({ where: { status: 'ACTIVE', clinic: { is: realFacility } }, _sum: { amount: true } }),
    distinctActiveUsersSince(range.toDay, range.toDay),
    distinctActiveUsersSince(wauFrom, range.toDay),
    distinctActiveUsersSince(mauFrom, range.toDay),
    activeUsersByDay(range),
    dailyCounts('Patient', 'createdAt', range, notDeleted),
    dailyCounts('Consultation', 'createdAt', range, notDeleted),
    dailyCounts('Appointment', 'createdAt', range, notDeleted),
    dailyCounts('Clinic', 'createdAt', range, notDeleted),
    loginsByDay(range, ['SUCCESS']),
    loginsByDay(range, ['WRONG_PASSWORD', 'BLOCKED']),
    prisma.$queryRaw<Array<{ role: string; n: number }>>(Prisma.sql`
      SELECT u."role"::text AS role, count(DISTINCT a."userId")::int AS n
      FROM "UserActivityDay" a JOIN "User" u ON u."id" = a."userId"
      WHERE a."day" >= ${range.fromDay}::date AND a."day" <= ${range.toDay}::date AND ${staffOnly}
      GROUP BY 1
    `),
    prisma.clinic.groupBy({ by: ['facilityType'], where: { ...realFacility, registrationStatus: 'APPROVED' }, _count: true }),
    prisma.clinic.groupBy({ by: ['district'], where: { ...realFacility, registrationStatus: 'APPROVED' }, _count: true }),
    prisma.$queryRaw<Array<{ since: Date | null }>>(Prisma.sql`
      SELECT LEAST((SELECT min("createdAt") FROM "UserActivityDay"), (SELECT min("createdAt") FROM "LoginEvent")) AS since
    `),
  ]);

  // --- facilities -----------------------------------------------------------
  const facilityCounts = { approved: 0, active: 0, suspended: 0, pending: 0, rejected: 0 };
  for (const row of clinicsByStatus) {
    if (row.registrationStatus === 'PENDING') facilityCounts.pending += row._count;
    else if (row.registrationStatus === 'REJECTED') facilityCounts.rejected += row._count;
    else {
      facilityCounts.approved += row._count;
      if (row.isActive) facilityCounts.active += row._count;
      else facilityCounts.suspended += row._count;
    }
  }

  // --- subscriptions --------------------------------------------------------
  const subCount = (status: string) => subscriptions.filter((s) => s.status === status).reduce((a, s) => a + s._count, 0);
  const trialsEndingSoon = await prisma.subscription.count({
    where: { status: 'TRIALING', trialEndsAt: { gte: now, lte: new Date(now.getTime() + 7 * DAY_MS) }, clinic: { is: realFacility } },
  });
  const customPlans = subscriptions.filter((s) => s.plan === 'CUSTOM').reduce((a, s) => a + s._count, 0);

  // --- per-facility engagement ---------------------------------------------
  const facilities = await facilityEngagement(range, now);

  // --- adoption, security, activity volumes --------------------------------
  const [
    prescriptionsWritten, prescriptionsDispensed,
    patientsWithAllergyRecord, coded, portalTotal, portalActivated, portalNew,
    docsStaff, docsPatient, appointmentsByStatus, labTests, referrals,
    syncConflicts, auditEvents, notifications,
    loginBreakdown, neverSignedIn, deactivated,
  ] = await Promise.all([
    countBetween('Prescription', 'createdAt', range.fromTs, range.toTs),
    prisma.prescription.count({ where: { dispensedByUserId: { not: null }, dispensedAt: { gte: range.fromTs, lt: range.toTs } } }),
    prisma.patient.count({ where: { deletedAt: null, allergyStatus: { not: 'UNKNOWN' }, clinic: { is: realFacility } } }),
    prisma.$queryRaw<Array<{ coded: number; total: number }>>(Prisma.sql`
      SELECT
        (SELECT count(*)::int FROM "Diagnosis" d JOIN "Consultation" c ON c."id" = d."consultationId"
          WHERE d."type" = 'PRIMARY' AND d."icd10Code" IS NOT NULL AND c."deletedAt" IS NULL
            AND c."createdAt" >= ${range.fromTs} AND c."createdAt" < ${range.toTs}) AS coded,
        (SELECT count(*)::int FROM "Consultation" c WHERE c."deletedAt" IS NULL
            AND c."createdAt" >= ${range.fromTs} AND c."createdAt" < ${range.toTs}) AS total
    `),
    prisma.patientAccount.count({ where: { status: { not: 'CLOSED' } } }),
    prisma.patientAccount.count({ where: { status: { not: 'CLOSED' }, mustResetPassword: false } }),
    countBetween('PatientAccount', 'createdAt', range.fromTs, range.toTs),
    prisma.document.count({ where: { uploadedByUserId: { not: null }, createdAt: { gte: range.fromTs, lt: range.toTs } } }),
    prisma.document.count({ where: { uploadedByPatientAccountId: { not: null }, createdAt: { gte: range.fromTs, lt: range.toTs } } }),
    prisma.appointment.groupBy({ by: ['status'], where: { deletedAt: null, createdAt: { gte: range.fromTs, lt: range.toTs } }, _count: true }),
    countBetween('LabTest', 'createdAt', range.fromTs, range.toTs, notDeleted),
    countBetween('Referral', 'createdAt', range.fromTs, range.toTs),
    countBetween('SyncConflictLog', 'createdAt', range.fromTs, range.toTs),
    countBetween('AuditLog', 'createdAt', range.fromTs, range.toTs),
    countBetween('Notification', 'createdAt', range.fromTs, range.toTs),
    prisma.loginEvent.groupBy({ by: ['outcome'], where: { createdAt: { gte: range.fromTs, lt: range.toTs } }, _count: true }),
    prisma.user.count({ where: { role: { not: 'SUPER_ADMIN' }, isActive: true, lastLoginAt: null, createdAt: { lt: new Date(now.getTime() - 7 * DAY_MS) }, clinic: { is: realFacility } } }),
    prisma.user.count({ where: { role: { not: 'SUPER_ADMIN' }, isActive: false, clinic: { is: { ...realFacility, registrationStatus: 'APPROVED' } } } }),
  ]);

  const outcome = (o: string) => loginBreakdown.find((l) => l.outcome === o)?._count ?? 0;
  const activatedFacilities = facilities.filter((f) => f.consultationsInPeriod > 0).length;
  const dailyActiveAvg = activeSeries.length ? sum(activeSeries) / activeSeries.length : 0;

  const topDistricts = [...districtCounts]
    .map((d) => ({ key: d.district || 'Not stated', count: d._count }))
    .sort((a, b) => b.count - a.count);

  return {
    generatedAt: now.toISOString(),
    timezone: 'East Africa Time (UTC+3)',
    trackingStartedAt: trackingBounds[0]?.since ? trackingBounds[0].since.toISOString() : null,
    period: { days, from: range.fromDay, to: range.toDay },

    headline: {
      facilities: { ...facilityCounts, new: registrationsCount, newChange: changeFrom(registrationsCount, registrationsPrev) },
      staff: {
        total: staffTotal,
        activeAccounts: staffByRole.reduce((a, r) => a + r._count, 0),
        activeToday: dau,
        activeThisWeek: wau,
        activeThisMonth: mau,
        // How often a monthly user shows up on a given day: a habit measure.
        stickiness: ratio(dailyActiveAvg, mau),
      },
      patients: { total: patientsTotal, new: patientsNew, newChange: changeFrom(patientsNew, patientsNewPrev) },
      consultations: { count: consultationsCount, change: changeFrom(consultationsCount, consultationsPrev) },
      revenue: {
        currency: 'UGX',
        inPeriod: revenueNow._sum.amount ?? 0,
        payments: revenueNow._count,
        change: changeFrom(revenueNow._sum.amount ?? 0, revenuePrev._sum.amount ?? 0),
        monthlyRecurring: mrr._sum.amount ?? 0,
      },
      subscriptions: {
        active: subCount('ACTIVE'), trialing: subCount('TRIALING'), pastDue: subCount('PAST_DUE'), cancelled: subCount('CANCELLED'),
        trialsEndingSoon, customPlans,
      },
    },

    series: {
      activeStaff: activeSeries,
      newPatients: newPatientsSeries,
      consultations: consultationsSeries,
      appointments: appointmentsSeries,
      newFacilities: registrationsSeries,
      signIns: loginsSeries,
      failedSignIns: failedLoginsSeries,
    },

    staffByRole: staffByRole
      .map((r) => ({ role: r.role, accounts: r._count, activeInPeriod: activeByRole.find((a) => a.role === r.role)?.n ?? 0 }))
      .sort((a, b) => b.accounts - a.accounts),

    distributions: {
      facilityTypes: typeCounts.map((t) => ({ key: t.facilityType, count: t._count })).sort((a, b) => b.count - a.count),
      districts: topDistricts.slice(0, 10),
      districtsOther: topDistricts.slice(10).reduce((a, d) => a + d.count, 0),
      subscriptionStatus: ['ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELLED'].map((s) => ({ key: s, count: subCount(s) })),
    },

    adoption: {
      facilitiesRecording: { count: activatedFacilities, of: facilityCounts.approved },
      prescriptions: { written: prescriptionsWritten, dispensed: prescriptionsDispensed, dispensedShare: ratio(prescriptionsDispensed, prescriptionsWritten) },
      allergiesRecorded: { patients: patientsWithAllergyRecord, of: patientsTotal, share: ratio(patientsWithAllergyRecord, patientsTotal) },
      codedDiagnoses: { consultations: coded[0]?.coded ?? 0, of: coded[0]?.total ?? 0, share: ratio(coded[0]?.coded ?? 0, coded[0]?.total ?? 0) },
      portal: { accounts: portalTotal, activated: portalActivated, activatedShare: ratio(portalActivated, portalTotal), createdInPeriod: portalNew },
      documents: { byStaff: docsStaff, byPatients: docsPatient },
      appointments: appointmentsByStatus.map((a) => ({ key: a.status, count: a._count })),
      labTests, referrals,
    },

    security: {
      signIns: outcome('SUCCESS'),
      wrongPassword: outcome('WRONG_PASSWORD'),
      blocked: outcome('BLOCKED'),
      accountsNeverSignedIn: neverSignedIn,
      deactivatedAccounts: deactivated,
      syncConflicts, auditEvents, notifications,
      pendingApprovals: facilityCounts.pending,
    },

    facilities,
  };
}

/** One row per approved facility, with how much it is being used. */
export async function facilityEngagement(range: Range, now: Date = new Date()) {
  const [clinics, staffPerClinic, activePerClinic, patientsPerClinic, newPatientsPerClinic, consultsPerClinic, lastSeen, lastConsult, lastPatient] = await Promise.all([
    prisma.clinic.findMany({
      where: { ...realFacility, registrationStatus: 'APPROVED' },
      select: {
        id: true, name: true, facilityCode: true, facilityType: true, district: true, isActive: true, createdAt: true,
        subscription: { select: { status: true, plan: true, trialEndsAt: true } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.user.groupBy({ by: ['clinicId'], where: { role: { not: 'SUPER_ADMIN' }, isActive: true }, _count: true }),
    prisma.$queryRaw<Array<{ clinicId: string; n: number }>>(Prisma.sql`
      SELECT a."clinicId", count(DISTINCT a."userId")::int AS n
      FROM "UserActivityDay" a JOIN "User" u ON u."id" = a."userId"
      WHERE a."day" >= ${range.fromDay}::date AND a."day" <= ${range.toDay}::date AND ${staffOnly}
      GROUP BY 1
    `),
    prisma.patient.groupBy({ by: ['clinicId'], where: { deletedAt: null }, _count: true }),
    prisma.patient.groupBy({ by: ['clinicId'], where: { deletedAt: null, createdAt: { gte: range.fromTs, lt: range.toTs } }, _count: true }),
    prisma.$queryRaw<Array<{ clinicId: string; n: number }>>(Prisma.sql`
      SELECT ap."clinicId", count(*)::int AS n
      FROM "Consultation" c JOIN "Appointment" ap ON ap."id" = c."appointmentId"
      WHERE c."deletedAt" IS NULL AND c."createdAt" >= ${range.fromTs} AND c."createdAt" < ${range.toTs}
      GROUP BY 1
    `),
    prisma.user.groupBy({ by: ['clinicId'], where: { role: { not: 'SUPER_ADMIN' } }, _max: { lastSeenAt: true } }),
    prisma.$queryRaw<Array<{ clinicId: string; at: Date }>>(Prisma.sql`
      SELECT ap."clinicId", max(c."createdAt") AS at
      FROM "Consultation" c JOIN "Appointment" ap ON ap."id" = c."appointmentId" WHERE c."deletedAt" IS NULL GROUP BY 1
    `),
    prisma.patient.groupBy({ by: ['clinicId'], where: { deletedAt: null }, _max: { createdAt: true } }),
  ]);

  const by = <T extends { clinicId: string }>(rows: T[]) => new Map(rows.map((r) => [r.clinicId, r]));
  const staff = by(staffPerClinic), active = by(activePerClinic), patients = by(patientsPerClinic), newPatients = by(newPatientsPerClinic);
  const consults = by(consultsPerClinic), seen = by(lastSeen), lastC = by(lastConsult), lastP = by(lastPatient);

  return clinics.map((c) => {
    const candidates = [seen.get(c.id)?._max.lastSeenAt, lastC.get(c.id)?.at, lastP.get(c.id)?._max.createdAt].filter((d): d is Date => !!d);
    const lastActivityAt = candidates.length ? new Date(Math.max(...candidates.map((d) => d.getTime()))) : null;
    return {
      id: c.id,
      name: c.name,
      facilityCode: c.facilityCode,
      facilityType: c.facilityType,
      district: c.district,
      suspended: !c.isActive,
      registeredAt: c.createdAt.toISOString(),
      subscription: c.subscription ? { status: c.subscription.status, plan: c.subscription.plan, trialEndsAt: c.subscription.trialEndsAt.toISOString() } : null,
      staffAccounts: (staff.get(c.id) as { _count: number } | undefined)?._count ?? 0,
      activeStaffInPeriod: (active.get(c.id) as { n: number } | undefined)?.n ?? 0,
      patients: (patients.get(c.id) as { _count: number } | undefined)?._count ?? 0,
      newPatientsInPeriod: (newPatients.get(c.id) as { _count: number } | undefined)?._count ?? 0,
      consultationsInPeriod: (consults.get(c.id) as { n: number } | undefined)?.n ?? 0,
      lastActivityAt: lastActivityAt ? lastActivityAt.toISOString() : null,
      engagement: engagementStatus(lastActivityAt, c.createdAt, now),
    };
  });
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function listStaff(query: { search?: string; role?: string; clinicId?: string; status?: string; sort?: string; page?: number; pageSize?: number }, now: Date = new Date()) {
  const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), 200);
  const page = Math.max(query.page ?? 1, 1);
  const since = addDays(eastAfricaDay(now), -29);

  const where: Prisma.UserWhereInput = {
    role: { not: 'SUPER_ADMIN' },
    clinic: { is: realFacility },
    ...(query.role && query.role !== 'ALL' ? { role: query.role as any } : {}),
    ...(query.clinicId ? { clinicId: query.clinicId } : {}),
    ...(query.status === 'active' ? { isActive: true } : query.status === 'inactive' ? { isActive: false } : {}),
    ...(query.search?.trim()
      ? {
          OR: [
            { name: { contains: query.search.trim(), mode: 'insensitive' } },
            { email: { contains: query.search.trim(), mode: 'insensitive' } },
            { clinic: { is: { name: { contains: query.search.trim(), mode: 'insensitive' } } } },
          ],
        }
      : {}),
  };
  // A role filter must not re-admit platform operators.
  if (where.role && typeof where.role === 'string' && where.role === 'SUPER_ADMIN') where.role = { not: 'SUPER_ADMIN' };

  const orderBy: Prisma.UserOrderByWithRelationInput[] =
    query.sort === 'name' ? [{ name: 'asc' }]
    : query.sort === 'created' ? [{ createdAt: 'desc' }]
    : [{ lastSeenAt: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }];

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where, orderBy, skip: (page - 1) * pageSize, take: pageSize,
      select: {
        id: true, name: true, email: true, role: true, isActive: true, createdAt: true, lastLoginAt: true, lastSeenAt: true,
        clinic: { select: { id: true, name: true, facilityCode: true } },
        _count: { select: { activityDays: { where: { day: { gte: new Date(`${since}T00:00:00.000Z`) } } } } },
      },
    }),
  ]);

  return {
    total, page, pageSize,
    users: rows.map(({ _count, createdAt, lastLoginAt, lastSeenAt, ...u }) => ({
      ...u,
      createdAt: createdAt.toISOString(),
      lastLoginAt: lastLoginAt ? lastLoginAt.toISOString() : null,
      lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : null,
      activeDaysLast30: _count.activityDays,
    })),
  };
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

export async function buildSystemReport() {
  const pingStart = process.hrtime.bigint();
  await prisma.$queryRaw`SELECT 1`;
  const pingMs = Number(process.hrtime.bigint() - pingStart) / 1e6;

  const [dbSize, tables, migrations, documents, counts] = await Promise.all([
    prisma.$queryRaw<Array<{ bytes: bigint }>>`SELECT pg_database_size(current_database()) AS bytes`,
    prisma.$queryRaw<Array<{ name: string; bytes: bigint; rows: bigint }>>`
      SELECT relname AS name, pg_total_relation_size(relid) AS bytes, n_live_tup AS rows
      FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 8`,
    prisma.$queryRaw<Array<{ applied: number; latest: string | null }>>`
      SELECT count(*)::int AS applied, (SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1) AS latest
      FROM _prisma_migrations WHERE finished_at IS NOT NULL`,
    prisma.document.aggregate({ _count: true, _sum: { fileSize: true } }),
    Promise.all([prisma.clinic.count(), prisma.user.count(), prisma.patient.count(), prisma.consultation.count(), prisma.auditLog.count()]),
  ]);

  const memory = process.memoryUsage();
  const has = (name: string) => !!process.env[name];
  return {
    generatedAt: new Date().toISOString(),
    server: {
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || 'development',
      release: process.env.RENDER_GIT_COMMIT ? process.env.RENDER_GIT_COMMIT.slice(0, 7) : null,
      memoryRssMb: Math.round(memory.rss / 1048576),
      heapUsedMb: Math.round(memory.heapUsed / 1048576),
    },
    database: {
      pingMs: Math.round(pingMs * 10) / 10,
      sizeBytes: Number(dbSize[0]?.bytes ?? 0),
      migrationsApplied: migrations[0]?.applied ?? 0,
      latestMigration: migrations[0]?.latest ?? null,
      largestTables: tables.map((t) => ({ name: t.name, bytes: Number(t.bytes), rows: Number(t.rows) })),
      totals: { facilities: counts[0], users: counts[1], patients: counts[2], consultations: counts[3], auditEntries: counts[4] },
    },
    storage: {
      documents: documents._count,
      documentBytes: documents._sum.fileSize ?? 0,
      // Uploaded files are only durable when a persistent directory is configured.
      persistent: has('DOCUMENT_STORAGE_DIR'),
    },
    // Whether each integration is configured - never the values themselves.
    configuration: [
      { key: 'email', label: 'Email (SMTP)', ok: has('SMTP_HOST') && has('SMTP_USER') && has('SMTP_PASSWORD'), hint: 'Registration, approval and notification emails' },
      { key: 'payments', label: 'Payments (Pesapal)', ok: has('PESAPAL_CONSUMER_KEY') && has('PESAPAL_CONSUMER_SECRET'), hint: 'Subscription payments' },
      { key: 'paymentNotices', label: 'Payment notifications (Pesapal IPN)', ok: has('PESAPAL_IPN_ID'), hint: 'Confirms payments automatically' },
      { key: 'documents', label: 'Durable document storage', ok: has('DOCUMENT_STORAGE_DIR'), hint: 'Uploaded files survive a restart' },
      { key: 'frontend', label: 'Frontend address', ok: has('FRONTEND_URL'), hint: 'Links in emails and cross-origin access' },
    ],
  };
}
