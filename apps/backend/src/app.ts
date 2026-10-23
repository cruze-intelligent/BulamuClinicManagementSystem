import Fastify, { FastifyInstance } from 'fastify';
import { STATUS_CODES } from 'http';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { appointmentRoutes } from './routes/appointment.routes';
import { authRoutes } from './routes/auth.routes';
import { clinicRoutes } from './routes/clinic.routes';
import { consultationRoutes } from './routes/consultation.routes';
import { dispensingRoutes } from './routes/dispensing.routes';
import { admissionRoutes } from './routes/admission.routes';
import { sharedHistoryRoutes } from './routes/shared-history.routes';
import { superAdminAnalyticsRoutes } from './routes/super-admin-analytics.routes';
import { recordRequest } from './lib/runtime-metrics';
import { dashboardRoutes } from './routes/dashboard.routes';
import { documentRoutes } from './routes/document.routes';
import { inventoryRoutes } from './routes/inventory.routes';
import { invoiceRoutes } from './routes/invoice.routes';
import { financeRoutes } from './routes/finance.routes';
import { labRoutes } from './routes/lab.routes';
import { leadsRoutes } from './routes/leads.routes';
import { patientRoutes } from './routes/patient.routes';
import { reportsRoutes } from './routes/reports.routes';
import { syncRoutes } from './routes/sync.routes';
import { userRoutes } from './routes/user.routes';
import { reproductiveHealthRoutes } from './routes/reproductive-health.routes';
import { referralRoutes } from './routes/referral.routes';
import { auditRoutes } from './routes/audit.routes';
import { billingRoutes } from './routes/billing.routes';
import { facilityLogoRoutes } from './routes/facility-logo.routes';
import { commentRoutes } from './routes/comment.routes';
import { patientAccountRoutes } from './routes/patient-account.routes';
import { patientAuthRoutes } from './routes/patient-auth.routes';
import { patientPortalRoutes } from './routes/patient-portal.routes';
import { patientAccessRoutes } from './routes/patient-access.routes';
import { notificationRoutes } from './routes/notification.routes';
import { patientAccountClosureRoutes } from './routes/patient-account-closure.routes';
import { SERVER_ERROR_MESSAGE } from './lib/http-error';
import { allowedOrigins, clientIp, clientIpSource, release } from './lib/connection';
import { prisma } from './lib/prisma';

export async function buildApp(): Promise<FastifyInstance> {
  const isProduction = process.env.NODE_ENV === 'production';
  const jwtSecret = process.env.JWT_SECRET;
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL must be configured before starting the Bulamu API');
  }

  if (isProduction && !jwtSecret) {
    throw new Error('JWT_SECRET must be configured in production');
  }

  const server = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : true,
  });

  // An error no route caught: one on our side (5xx) is logged and answered in
  // plain words - its technical detail never reaches the screen. Anything else
  // (a malformed request, say) keeps Fastify's usual answer.
  server.setErrorHandler((error, request, reply) => {
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'Unhandled error');
      return reply.status(status).send({ error: SERVER_ERROR_MESSAGE });
    }
    // Screens show `error`; for too many attempts, make it say what to do.
    const label = status === 429 ? 'Too many attempts. Please wait a minute and try again.' : STATUS_CODES[status] ?? 'Error';
    return reply.status(status).send({ statusCode: status, code: error.code, error: label, message: error.message });
  });

  // Response-time and error counts for the operator's system panel. Routes are
  // labelled by their pattern (/patients/:id), never the concrete URL, so the set
  // stays small and no identifier ever lands in it. Health checks and CORS
  // pre-flights are not real traffic.
  server.addHook('onResponse', (request, reply, done) => {
    if (request.method !== 'OPTIONS' && !request.url.startsWith('/health')) {
      recordRequest({
        method: request.method,
        route: request.routeOptions?.url ?? 'unmatched',
        status: reply.statusCode,
        ms: reply.elapsedTime,
      });
    }
    done();
  });

  // Browsers often send "Content-Type: application/json" on a POST that has no
  // body (an action button). Fastify's default parser rejects that outright, so a
  // perfectly reasonable request would fail with a parse error before reaching its
  // route. An empty JSON body is simply an empty object; malformed JSON is still a 400.
  server.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    if (body === '' || body === undefined) return done(null, {});
    try {
      done(null, JSON.parse(body as string));
    } catch (error) {
      (error as { statusCode?: number }).statusCode = 400;
      done(error as Error, undefined);
    }
  });

  // Only Bulamu's own site (bulamu.site and www.bulamu.site) may call the API
  // from a browser; any other site is given no permission at all.
  const origins = allowedOrigins();
  await server.register(cors, {
    origin: (origin, callback) => callback(null, !!origin && origins.has(origin)),
  });

  await server.register(jwt, {
    secret: jwtSecret || 'bulamu_local_development_secret',
  });

  await server.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  });

  // global: false - no existing route is rate-limited by default (avoids any
  // risk to the existing test suite / behavior). Individual routes opt in
  // via `config: { rateLimit: {...} }`, starting with the patient-auth
  // surfaces (login, password reset, portal lookup) which are the genuinely
  // abuse-prone new endpoints this plugin exists to protect.
  await server.register(rateLimit, {
    global: false,
    max: process.env.NODE_ENV === 'test' ? 100000 : 20,
    timeWindow: '1 minute',
    // Each visitor is counted by their own address, never the proxy's (lib/connection.ts).
    keyGenerator: clientIp,
  });

  // Render's health check: answers at once, without the database, so a slow
  // database wake-up never gets the server restarted. Says which commit runs,
  // so a deploy can confirm Render is serving it.
  server.get('/health', async () => {
    return { status: 'ok', service: 'Bulamu API', release: release() };
  });

  // The whole path, for monitoring and the site's early wake-up call: whether
  // the API reaches its database, and how fast. Reveals no data; the database
  // is asked only "SELECT 1".
  server.get('/health/connection', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const started = process.hrtime.bigint();
    let database: 'ok' | 'unreachable' = 'ok';
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 10_000); }),
      ]);
    } catch {
      database = 'unreachable';
    } finally {
      clearTimeout(timer);
    }
    const databaseMs = Math.round(Number(process.hrtime.bigint() - started) / 1e5) / 10;
    reply.header('Cache-Control', 'no-store');
    return reply.status(database === 'ok' ? 200 : 503).send({
      status: database === 'ok' ? 'ok' : 'degraded',
      release: release(),
      uptimeSeconds: Math.round(process.uptime()),
      database,
      databaseMs,
      clientIpSource: clientIpSource(request),
    });
  });

  await server.register(clinicRoutes);
  await server.register(authRoutes);
  await server.register(patientRoutes);
  await server.register(appointmentRoutes);
  await server.register(consultationRoutes);
  await server.register(dispensingRoutes);
  await server.register(admissionRoutes);
  await server.register(sharedHistoryRoutes);
  await server.register(superAdminAnalyticsRoutes);
  await server.register(dashboardRoutes);
  await server.register(invoiceRoutes);
  await server.register(financeRoutes);
  await server.register(userRoutes);
  await server.register(reportsRoutes);
  await server.register(inventoryRoutes);
  await server.register(labRoutes);
  await server.register(leadsRoutes);
  await server.register(syncRoutes);
  await server.register(reproductiveHealthRoutes);
  await server.register(referralRoutes);
  await server.register(auditRoutes);
  await server.register(billingRoutes);
  await server.register(facilityLogoRoutes);
  await server.register(documentRoutes);
  await server.register(commentRoutes);
  await server.register(patientAccountRoutes);
  await server.register(patientAuthRoutes);
  await server.register(patientPortalRoutes);
  await server.register(patientAccessRoutes);
  await server.register(notificationRoutes);
  await server.register(patientAccountClosureRoutes);

  return server;
}
