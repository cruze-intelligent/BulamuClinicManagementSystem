import { FastifyInstance } from 'fastify';
import { requireRole } from '../middleware/rbac.middleware';
import { buildAnalytics, buildSystemReport, listStaff, parseDays } from '../lib/analytics';
import { snapshotRuntimeMetrics } from '../lib/runtime-metrics';
import { purgeOldUsageRecords } from '../lib/usage-tracking';
import { buildCsv, sendCsv } from '../lib/csv';
import { ADMIN_NOTIFY_EMAIL, mailStatus, operatorAlertEmail, sendMail } from '../lib/mailer';
import { buildSampleDocuments } from '../lib/sample-documents';
import { sweepLapsedSubscriptions } from '../lib/subscription';
import { alertOperator } from '../lib/operator-alerts';
import { prisma } from '../lib/prisma';
import { getAuthUser } from '../middleware/auth.middleware';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The platform operator's view of how Bulamu is being used and how the system is
 * doing. SUPER_ADMIN only. Counts and timestamps - never clinical content.
 */
export async function superAdminAnalyticsRoutes(fastify: FastifyInstance) {
  fastify.get('/super-admin/analytics', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
    const days = parseDays((request.query as { days?: string }).days);
    try {
      // Old usage records are dropped whenever the operator looks, so no separate job is needed.
      await purgeOldUsageRecords();
      // So a trial that ended unpaid counts as past due, not as a trial.
      await sweepLapsedSubscriptions();
      return { success: true, analytics: await buildAnalytics(days) };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  fastify.get('/super-admin/system', { preHandler: [requireRole('SUPER_ADMIN')] }, async (_request, reply) => {
    try {
      return { success: true, system: { ...(await buildSystemReport()), runtime: snapshotRuntimeMetrics(), mail: mailStatus() } };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // Sends a test email to the operator inbox (never to an address the caller
  // chooses) and reports exactly what happened, so delivery can be checked
  // from the console instead of the server logs.
  fastify.post('/super-admin/system/test-email', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request) => {
    const actor = await prisma.user.findUnique({ where: { id: getAuthUser(request).userId }, select: { name: true } });
    const result = await alertOperator({
      subject: 'Test email',
      heading: 'Bulamu email is working',
      intro: 'This is a test email sent from the System page of Platform analytics. Registrations, approvals, payments and other platform events will arrive at this inbox the same way.',
      facts: [
        ['Requested by', actor?.name],
        ['Sent at', new Date().toLocaleString('en-GB', { timeZone: 'Africa/Kampala' }) + ' (EAT)'],
      ],
    });
    return { success: true, result, mail: mailStatus() };
  });

  // One of every document Bulamu produces - made-up details, stamped SAMPLE on
  // every page - emailed to the operator inbox (never an address the caller
  // chooses) so branding can be checked without touching anyone's records.
  fastify.post('/super-admin/system/sample-documents', { preHandler: [requireRole('SUPER_ADMIN')] }, async (_request, reply) => {
    try {
      const documents = await buildSampleDocuments();
      const result = await sendMail({
        to: ADMIN_NOTIFY_EMAIL,
        subject: '[Bulamu] Sample documents for checking',
        html: operatorAlertEmail({
          heading: 'Sample documents',
          intro: "One of every document Bulamu produces is attached, filled with made-up details and stamped SAMPLE on every page. Facility documents carry the facility's logo when it has added one; receipts are Bulamu's own.",
          facts: documents.map((d, i) => [`${i + 1}`, d.title]),
        }),
        attachments: documents.map((d) => ({ filename: d.filename, content: d.content, contentType: 'application/pdf' })),
      });
      return { success: true, result, documents: documents.map((d) => d.title), mail: mailStatus() };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // The staff directory with usage: who they are, where they work, when they were
  // last seen and how many of the last 30 days they were active.
  fastify.get('/super-admin/users', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    try {
      return {
        success: true,
        ...(await listStaff({
          search: q.search, role: q.role, clinicId: q.clinicId, status: q.status, sort: q.sort,
          page: q.page ? Number(q.page) : 1, pageSize: q.pageSize ? Number(q.pageSize) : 25,
        })),
      };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // Download a dataset as CSV: the facilities table, the day-by-day series, or the staff directory.
  fastify.get('/super-admin/analytics/export', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
    const q = request.query as { dataset?: string; days?: string; search?: string; role?: string; clinicId?: string; status?: string };
    const days = parseDays(q.days);
    try {
      if (q.dataset === 'users') {
        // The directory export is not capped at one screen: walk the pages.
        const first = await listStaff({ search: q.search, role: q.role, clinicId: q.clinicId, status: q.status, pageSize: 200, page: 1 });
        const all = [...first.users];
        for (let page = 2; all.length < first.total && page <= 25; page++) {
          all.push(...(await listStaff({ search: q.search, role: q.role, clinicId: q.clinicId, status: q.status, pageSize: 200, page })).users);
        }
        const csv = buildCsv<(typeof all)[number]>(
          [
            ['Name', (u) => u.name], ['Email', (u) => u.email], ['Role', (u) => u.role],
            ['Facility', (u) => u.clinic.name], ['Facility ID', (u) => u.clinic.facilityCode],
            ['Active account', (u) => (u.isActive ? 'Yes' : 'No')], ['Registered', (u) => u.createdAt],
            ['Last sign-in', (u) => u.lastLoginAt], ['Last seen', (u) => u.lastSeenAt], ['Active days (last 30)', (u) => u.activeDaysLast30],
          ],
          all
        );
        return sendCsv(reply, `bulamu-staff-usage-${today()}.csv`, csv);
      }

      const analytics = await buildAnalytics(days);

      if (q.dataset === 'daily') {
        const s = analytics.series;
        const rows = s.activeStaff.map((p, i) => ({
          date: p.date, activeStaff: p.value, newPatients: s.newPatients[i].value, consultations: s.consultations[i].value,
          appointments: s.appointments[i].value, newFacilities: s.newFacilities[i].value, signIns: s.signIns[i].value, failedSignIns: s.failedSignIns[i].value,
        }));
        const csv = buildCsv<(typeof rows)[number]>(
          [
            ['Date (EAT)', (r) => r.date], ['Active staff', (r) => r.activeStaff], ['New patients', (r) => r.newPatients],
            ['Consultations', (r) => r.consultations], ['Appointments booked', (r) => r.appointments], ['New facility registrations', (r) => r.newFacilities],
            ['Successful sign-ins', (r) => r.signIns], ['Failed or blocked sign-ins', (r) => r.failedSignIns],
          ],
          rows
        );
        return sendCsv(reply, `bulamu-daily-activity-${days}d-${today()}.csv`, csv);
      }

      // Default: the facilities table.
      const csv = buildCsv<(typeof analytics.facilities)[number]>(
        [
          ['Facility ID', (f) => f.facilityCode], ['Name', (f) => f.name], ['Type', (f) => f.facilityType], ['District', (f) => f.district],
          ['Engagement', (f) => f.engagement], ['Last activity', (f) => f.lastActivityAt], ['Registered', (f) => f.registeredAt],
          ['Suspended', (f) => (f.suspended ? 'Yes' : 'No')], ['Subscription', (f) => f.subscription?.status], ['Plan', (f) => f.subscription?.plan],
          ['Staff accounts', (f) => f.staffAccounts], [`Active staff (last ${days} days)`, (f) => f.activeStaffInPeriod],
          ['Patients', (f) => f.patients], [`New patients (last ${days} days)`, (f) => f.newPatientsInPeriod],
          [`Consultations (last ${days} days)`, (f) => f.consultationsInPeriod],
        ],
        analytics.facilities
      );
      return sendCsv(reply, `bulamu-facility-usage-${days}d-${today()}.csv`, csv);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });
}
