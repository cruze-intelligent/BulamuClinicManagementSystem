import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireRole } from '../middleware/rbac.middleware';
import { buildAnalytics, buildSystemReport, facilityEngagement, listStaff, parseDays, periodRange } from '../lib/analytics';
import { snapshotRuntimeMetrics } from '../lib/runtime-metrics';
import { eastAfricaDay, purgeOldUsageRecords } from '../lib/usage-tracking';
import { buildCsv, sendCsv } from '../lib/csv';
import { ADMIN_NOTIFY_EMAIL, demoFacilityEmail, facilityReminderEmail, FacilityReminderKind, formatEmailDate, mailStatus, operatorAlertEmail, sendMail } from '../lib/mailer';
import { buildSampleDocuments } from '../lib/sample-documents';
import { buildSampleEmails } from '../lib/sample-emails';
import { sweepLapsedSubscriptions } from '../lib/subscription';
import { alertOperator, frontendUrl } from '../lib/operator-alerts';
import { prisma } from '../lib/prisma';
import { getAuthUser } from '../middleware/auth.middleware';
import { closeExpiredDemos, createDemoFacility, demoUsage } from '../lib/demo-facility';
import { isValidEmail } from '../lib/portal-invite';
import { recordAudit } from '../lib/audit';
import { sendRouteError } from '../lib/http-error';
import { documentProducer as documentProducerFor } from '../lib/document-signer';
import { emailReportCopy } from '../lib/report-delivery';
import { COMPANY_NAME, bulamuLetterhead, generateTableReportPdf } from '../lib/pdf';
import { REAL_FACILITY } from '../lib/facility';

/** An operator export is also emailed to the operator who made it (?email=0 to skip). */
function sendOperatorCsv(request: FastifyRequest, reply: FastifyReply, filename: string, csv: string, title: string) {
  const copy = (request.query as { email?: string }).email === '0'
    ? Promise.resolve(null)
    : emailReportCopy(reply, getAuthUser(request).userId, { title, filename, content: csv, contentType: 'text/csv' }, (m) => request.log.warn(m));
  return copy.then(() => sendCsv(reply, filename, csv));
}

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
      return sendRouteError(reply, error);
    }
  });

  fastify.get('/super-admin/system', { preHandler: [requireRole('SUPER_ADMIN')] }, async (_request, reply) => {
    try {
      return { success: true, system: { ...(await buildSystemReport()), runtime: snapshotRuntimeMetrics(), mail: mailStatus() } };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // A fresh, privacy-safe list of approved facilities without activity for at
  // least 30 days. The operator chooses whether and which of four messages to
  // send; the inactivity signal never suspends or deletes a facility.
  fastify.get('/super-admin/facility-reminders', { preHandler: [requireRole('SUPER_ADMIN')] }, async (_request, reply) => {
    try {
      const now = new Date();
      const activity = await facilityEngagement(periodRange(30, now), now);
      const eligible = activity.map((facility) => {
        const lastAt = facility.lastActivityAt ?? facility.registeredAt;
        const idleDays = Math.floor((now.getTime() - new Date(lastAt).getTime()) / (24 * 60 * 60 * 1000));
        return { ...facility, lastActivityAt: facility.lastActivityAt, idleDays };
      }).filter((facility) => facility.suspended === false && facility.idleDays >= 30);
      if (!eligible.length) return { success: true, facilities: [] };
      const admins = await prisma.user.findMany({
        where: { clinicId: { in: eligible.map((f) => f.id) }, role: 'ADMIN', isActive: true },
        select: { clinicId: true, name: true, email: true }, orderBy: { createdAt: 'asc' },
      });
      const adminByClinic = new Map<string, (typeof admins)[number]>();
      admins.forEach((admin) => { if (!adminByClinic.has(admin.clinicId)) adminByClinic.set(admin.clinicId, admin); });
      return { success: true, facilities: eligible.map(({ id, name, facilityCode, lastActivityAt, idleDays }) => {
        const admin = adminByClinic.get(id);
        return { id, name, facilityCode, lastActivityAt, idleDays, admin: admin ? { name: admin.name, email: admin.email } : null };
      }) };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  fastify.post('/super-admin/facility-reminders/:clinicId', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
    const { clinicId } = request.params as { clinicId: string };
    const body = request.body as { kind?: unknown } | undefined;
    const kinds: FacilityReminderKind[] = ['INACTIVITY', 'FEATURES', 'ONBOARDING', 'RETENTION'];
    if (typeof body?.kind !== 'string' || !kinds.includes(body.kind as FacilityReminderKind)) {
      return reply.status(400).send({ error: 'Choose one of the available facility reminders' });
    }
    try {
      const clinic = await prisma.clinic.findFirst({
        where: { ...REAL_FACILITY, id: clinicId, registrationStatus: 'APPROVED', isActive: true },
        include: { users: { where: { role: 'ADMIN', isActive: true }, select: { id: true, name: true, email: true }, orderBy: { createdAt: 'asc' }, take: 1 } },
      });
      if (!clinic) return reply.status(404).send({ error: 'Active approved facility not found' });
      const admin = clinic.users[0];
      if (!admin) return reply.status(409).send({ error: 'This facility has no active administrator to email' });
      if (body.kind === 'INACTIVITY') {
        const now = new Date();
        const activity = await facilityEngagement(periodRange(30, now), now);
        const target = activity.find((f) => f.id === clinic.id);
        const lastAt = target?.lastActivityAt ?? target?.registeredAt;
        const idleDays = lastAt ? Math.floor((now.getTime() - new Date(lastAt).getTime()) / (24 * 60 * 60 * 1000)) : 0;
        if (idleDays < 30) return reply.status(409).send({ error: 'The 30-day inactivity reminder is only available after 30 days without recorded activity' });
      }
      const kind = body.kind as FacilityReminderKind;
      const message = facilityReminderEmail({
        kind, recipientName: admin.name, facilityName: clinic.name,
        loginUrl: frontendUrl('/auth/login'), retentionUrl: frontendUrl('/legal/data-retention'),
      });
      const result = await sendMail({ to: admin.email, ...message });
      await recordAudit({
        entity: 'FacilityReminder', recordId: clinic.id, clinicId: clinic.id, action: 'CREATE',
        actorUserId: getAuthUser(request).userId, actorRole: 'SUPER_ADMIN',
        metadata: { kind, recipient: admin.email, sent: result.sent },
      });
      return { success: true, sent: result.sent, reason: result.reason, recipient: admin.email };
    } catch (error: any) {
      return sendRouteError(reply, error);
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
      return sendRouteError(reply, error);
    }
  });

  // One of every email Bulamu sends - made-up details, exactly as a recipient
  // would see it - to the operator inbox (never an address the caller chooses), so
  // their look and wording can be checked in a real inbox.
  fastify.post('/super-admin/system/sample-emails', { preHandler: [requireRole('SUPER_ADMIN')] }, async (_request, reply) => {
    try {
      const samples = buildSampleEmails();
      let sent = 0;
      let reason: string | undefined;
      // One after another: a burst of parallel sends is what mail servers throttle.
      for (const sample of samples) {
        const result = await sendMail({ to: ADMIN_NOTIFY_EMAIL, subject: sample.subject, html: sample.html });
        if (result.sent) sent++;
        else reason ??= result.reason;
      }
      return { success: true, total: samples.length, sent, reason, mail: mailStatus() };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // Creates a new private demo facility and emails its sign-ins to the address given.
  // The logins are also returned, so they can be shown once on screen.
  fastify.post('/super-admin/system/demo-facility', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
    const { email, replacesEarlier } = (request.body ?? {}) as { email?: unknown; replacesEarlier?: unknown };
    if (!isValidEmail(email)) return reply.status(400).send({ error: 'Enter the email address to send the demo logins to' });
    try {
      // Every request is a new demo of its own, so logins already sent to
      // anyone else keep working.
      await closeExpiredDemos();
      const demo = await createDemoFacility();
      const result = await sendMail({
        to: email.trim(),
        subject: replacesEarlier === true ? 'Your Bulamu demo, with new sign-ins that work' : 'Thank you for your interest in Bulamu: your demo is ready',
        html: demoFacilityEmail({
          loginUrl: frontendUrl('/auth/login'), registerUrl: frontendUrl('/auth/register'),
          password: demo.password, expiresAt: demo.expiresAt, accounts: demo.accounts,
          patient: { name: demo.patient.name, email: demo.patient.email, portalUrl: frontendUrl('/patient-portal/login') },
          replacesEarlier: replacesEarlier === true,
        }),
      });
      const authUser = getAuthUser(request);
      // Who it was sent to is deliberately not recorded: only how the demo is used.
      await recordAudit({
        entity: 'Clinic', recordId: demo.clinicId, clinicId: demo.clinicId, action: 'CREATE',
        actorUserId: authUser.userId, actorRole: authUser.role, metadata: { demo: true, demoCode: demo.demoCode },
      });
      return {
        success: true, facilityCode: demo.facilityCode, demoCode: demo.demoCode, password: demo.password,
        expiresAt: demo.expiresAt.toISOString(), accounts: demo.accounts, patient: demo.patient, result,
      };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // How each demo has been used - all that is kept about a demo.
  fastify.get('/super-admin/demos', { preHandler: [requireRole('SUPER_ADMIN')] }, async (_request, reply) => {
    try {
      await closeExpiredDemos();
      return { success: true, demos: await demoUsage() };
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

  // Ends a demo before its time (a mistaken send, say): its sign-ins stop at once.
  fastify.post('/super-admin/demos/:clinicId/close', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
    const { clinicId } = request.params as { clinicId: string };
    try {
      const demo = await prisma.clinic.findFirst({ where: { id: clinicId, isDemo: true, deletedAt: null }, select: { id: true } });
      if (!demo) return reply.status(404).send({ error: 'No open demo with that ID' });
      await prisma.clinic.update({ where: { id: clinicId }, data: { demoExpiresAt: new Date() } });
      await closeExpiredDemos();
      const authUser = getAuthUser(request);
      await recordAudit({ entity: 'Clinic', recordId: clinicId, clinicId, action: 'UPDATE', actorUserId: authUser.userId, actorRole: authUser.role, metadata: { demo: true, closed: true } });
      return { success: true };
    } catch (error: any) {
      return sendRouteError(reply, error);
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
      return sendRouteError(reply, error);
    }
  });

  // Download a dataset as CSV: the facilities table, the day-by-day series, or the staff directory.
  // The platform report: how Bulamu is being used over the period, as a PDF
  // under Bulamu's letterhead - downloaded, and a copy emailed to the operator.
  // Counts only - never patient or clinical details.
  fastify.get('/super-admin/analytics/report.pdf', { preHandler: [requireRole('SUPER_ADMIN')] }, async (request, reply) => {
    const query = request.query as { days?: string; year?: string };
    const requestedYear = Number(query.year);
    const currentYear = new Date().getFullYear();
    const annual = Number.isInteger(requestedYear) && requestedYear >= 2020 && requestedYear <= currentYear;
    if (query.year !== undefined && !annual) return reply.status(400).send({ error: `Choose an annual report year from 2020 to ${currentYear}` });
    const reportAt = annual && requestedYear < currentYear
      ? new Date(Date.UTC(requestedYear, 11, 31, 20, 0, 0))
      : new Date();
    const yearDay = annual ? new Date(Date.UTC(requestedYear, 0, 1)) : null;
    const endDay = annual ? new Date(`${eastAfricaDay(reportAt)}T00:00:00Z`) : null;
    const days = annual && yearDay && endDay ? Math.floor((endDay.getTime() - yearDay.getTime()) / (24 * 60 * 60 * 1000)) + 1 : parseDays(query.days);
    try {
      await sweepLapsedSubscriptions();
      const a = await buildAnalytics(days, reportAt);
      const h = a.headline;
      const n = (value: number) => value.toLocaleString('en-US');
      const pct = (value: number | null | undefined) => (value === null || value === undefined ? '-' : `${Math.round(value * 100)}%`);
      const filename = annual ? `bulamu-annual-system-report-${requestedYear}.pdf` : `bulamu-platform-report-${days}d-${today()}.pdf`;
      const pdf = await generateTableReportPdf({
        letterhead: bulamuLetterhead(`Platform report - ${COMPANY_NAME}`),
        title: annual ? 'ANNUAL SYSTEM PERFORMANCE REPORT' : 'PLATFORM REPORT',
        subtitle: annual
          ? `${a.period.from} to ${a.period.to} - ${requestedYear === currentYear ? 'year to date' : 'full calendar year'}, East Africa Time (UTC+3)`
          : `${a.period.from} to ${a.period.to} - the last ${days} days, East Africa Time`,
        facts: [
          annual
            ? ['Facility status snapshot today', `${n(h.facilities.approved - h.facilities.suspended)} approved and enabled, ${n(h.facilities.suspended)} suspended`]
            : ['Facilities approved', `${n(h.facilities.approved)} (${n(h.facilities.active)} active in the last 7 days, ${n(h.facilities.approved - h.facilities.active - h.facilities.suspended)} quiet or dormant, ${n(h.facilities.suspended)} suspended)`],
          ['Waiting for approval', n(h.facilities.pending)],
          ['New registrations in the period', n(h.facilities.new)],
          ['Staff accounts', `${n(h.staff.total)} (${n(h.staff.activeThisMonth)} active in the last 30 days${annual ? ' of the report period' : ''}${annual ? '' : `, ${n(h.staff.activeToday)} today`})`],
          [annual ? 'Current patient records' : 'Patients', `${n(h.patients.total)} (${n(h.patients.new)} new in the period)`],
          ['Consultations in the period', n(h.consultations.count)],
          ['Subscription revenue in the period', `UGX ${n(h.revenue.inPeriod)} from ${n(h.revenue.payments)} payments`],
          ['Monthly recurring revenue (current)', `UGX ${n(h.revenue.monthlyRecurring)}`],
          ['Subscriptions (current status)', `${n(h.subscriptions.active)} active, ${n(h.subscriptions.trialing)} on trial, ${n(h.subscriptions.pastDue)} past due, ${n(h.subscriptions.cancelled)} cancelled`],
          ['Facilities recording care', `${n(a.adoption.facilitiesRecording.count)} of ${n(a.adoption.facilitiesRecording.of)}`],
          ['Prescriptions dispensed', `${pct(a.adoption.prescriptions.dispensedShare)} of ${n(a.adoption.prescriptions.written)} written`],
          ['Ward / laboratory tests', n(a.adoption.labTests)],
          ['Referrals', n(a.adoption.referrals)],
          ['Diagnoses with ICD-10 code', `${pct(a.adoption.codedDiagnoses.of ? a.adoption.codedDiagnoses.consultations / a.adoption.codedDiagnoses.of : null)} (${n(a.adoption.codedDiagnoses.consultations)} of ${n(a.adoption.codedDiagnoses.of)})`],
          ['Patient Portal accounts', `${n(a.adoption.portal.activated)} active of ${n(a.adoption.portal.accounts)} created`],
          ['Documents stored', `${n(a.adoption.documents.byStaff + a.adoption.documents.byPatients)} (${n(a.adoption.documents.byStaff)} staff, ${n(a.adoption.documents.byPatients)} patient)`],
          ['Sign-in security events', `${n(a.security.signIns)} successful, ${n(a.security.wrongPassword)} incorrect-password, ${n(a.security.blocked)} blocked`],
          ['Audit trail entries', n(a.security.auditEvents)],
          ['In-app notifications', n(a.security.notifications)],
          ['Report scope', `${annual ? 'Activity metrics cover the selected report period; current facility and subscription statuses are snapshots.' : 'Metrics cover the selected report period.'} Real, non-demo facilities; aggregate counts only; no patient names or clinical content`],
          ['Prepared', formatEmailDate(new Date())],
        ],
        tables: [
          {
            title: 'Facilities',
            note: `Engagement and activity over the last ${days} days.`,
            columns: [
              { header: 'Facility', width: 150 }, { header: 'District', width: 75 }, { header: 'Engagement', width: 70 }, { header: 'Subscription', width: 70 },
              { header: 'Staff', width: 40, align: 'right' }, { header: 'Patients', width: 50, align: 'right' }, { header: 'Visits', width: 40, align: 'right' },
            ],
            rows: a.facilities.map((f) => [
              `${f.name}${f.facilityCode ? ` (${f.facilityCode})` : ''}`, f.district ?? '-', String(f.engagement ?? '-'), f.subscription?.status ?? '-',
              n(f.staffAccounts), n(f.patients), n(f.consultationsInPeriod),
            ]),
          },
          {
            title: 'Staff by role',
            columns: [{ header: 'Role', width: 245 }, { header: 'Accounts', width: 125, align: 'right' }, { header: 'Active in the period', width: 125, align: 'right' }],
            rows: a.staffByRole.map((r) => [String(r.role), n(r.accounts), n(r.activeInPeriod)]),
          },
          {
            title: 'Facilities by district',
            columns: [{ header: 'District', width: 370 }, { header: 'Facilities', width: 125, align: 'right' }],
            rows: [...a.distributions.districts.map((d) => [d.key, n(d.count)]), ...(a.distributions.districtsOther ? [['Other districts', n(a.distributions.districtsOther)]] : [])],
          },
          {
            title: 'Care delivery and service activity',
            columns: [{ header: 'Measure', width: 370 }, { header: 'Count', width: 125, align: 'right' }],
            rows: [
              ['New patient records', n(h.patients.new)], ['Consultations', n(h.consultations.count)],
              ['Appointments', n(a.series.appointments.reduce((sum, point) => sum + point.value, 0))],
              ['Prescriptions written', n(a.adoption.prescriptions.written)], ['Prescriptions dispensed', n(a.adoption.prescriptions.dispensed)],
              ['Lab tests requested', n(a.adoption.labTests)], ['Referrals created', n(a.adoption.referrals)],
              ...a.adoption.appointments.map((row) => [`Appointments - ${row.key.toLowerCase().replaceAll('_', ' ')}`, n(row.count)]),
            ],
          },
          {
            title: 'Digital adoption and record quality',
            columns: [{ header: 'Measure', width: 370 }, { header: 'Result', width: 125, align: 'right' }],
            rows: [
              ['Facilities recording care', `${n(a.adoption.facilitiesRecording.count)} of ${n(a.adoption.facilitiesRecording.of)}`],
              ['Primary diagnoses with ICD-10 code', `${n(a.adoption.codedDiagnoses.consultations)} of ${n(a.adoption.codedDiagnoses.of)}`],
              ['Patient Portal accounts activated', `${n(a.adoption.portal.activated)} of ${n(a.adoption.portal.accounts)}`],
              ['Documents uploaded by staff', n(a.adoption.documents.byStaff)], ['Documents uploaded by patients', n(a.adoption.documents.byPatients)],
            ],
          },
          {
            title: 'Security and governance activity',
            columns: [{ header: 'Measure', width: 370 }, { header: 'Count', width: 125, align: 'right' }],
            rows: [
              ['Successful sign-ins', n(a.security.signIns)], ['Incorrect-password sign-ins', n(a.security.wrongPassword)],
              ['Blocked sign-ins', n(a.security.blocked)], ['Audit trail entries', n(a.security.auditEvents)],
              ['Sync conflicts', n(a.security.syncConflicts)], ['In-app notifications', n(a.security.notifications)],
            ],
          },
          {
            title: 'Subscription status at report generation',
            note: 'Status counts are a current snapshot; revenue above is measured within the stated report period.',
            columns: [{ header: 'Status', width: 370 }, { header: 'Facilities', width: 125, align: 'right' }],
            rows: [
              ['Active', n(h.subscriptions.active)], ['Trialing', n(h.subscriptions.trialing)],
              ['Past due', n(h.subscriptions.pastDue)], ['Cancelled', n(h.subscriptions.cancelled)],
              ['Custom plans', n(h.subscriptions.customPlans)],
            ],
          },
        ],
        producedBy: await documentProducerFor(getAuthUser(request).userId),
      });
      if ((request.query as { email?: string }).email !== '0') {
        await emailReportCopy(reply, getAuthUser(request).userId, {
          title: annual ? `Annual system performance report - ${requestedYear}` : `Bulamu platform report - last ${days} days`, filename, content: pdf, contentType: 'application/pdf',
          facts: [['Period', `${a.period.from} to ${a.period.to}`]],
        }, (m) => request.log.warn(m));
      }
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(pdf);
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });

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
        return sendOperatorCsv(request, reply, `bulamu-staff-usage-${today()}.csv`, csv, 'Staff and usage export');
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
        return sendOperatorCsv(request, reply, `bulamu-daily-activity-${days}d-${today()}.csv`, csv, `Daily activity export - last ${days} days`);
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
      return sendOperatorCsv(request, reply, `bulamu-facility-usage-${days}d-${today()}.csv`, csv, `Facility usage export - last ${days} days`);
    } catch (error: any) {
      return sendRouteError(reply, error);
    }
  });
}
