import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { appointmentRoutes } from './routes/appointment.routes';
import { authRoutes } from './routes/auth.routes';
import { clinicRoutes } from './routes/clinic.routes';
import { consultationRoutes } from './routes/consultation.routes';
import { dashboardRoutes } from './routes/dashboard.routes';
import { documentRoutes } from './routes/document.routes';
import { inventoryRoutes } from './routes/inventory.routes';
import { invoiceRoutes } from './routes/invoice.routes';
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
import { commentRoutes } from './routes/comment.routes';
import { patientAccountRoutes } from './routes/patient-account.routes';
import { patientAuthRoutes } from './routes/patient-auth.routes';
import { patientPortalRoutes } from './routes/patient-portal.routes';
import { patientAccessRoutes } from './routes/patient-access.routes';
import { notificationRoutes } from './routes/notification.routes';
import { patientAccountClosureRoutes } from './routes/patient-account-closure.routes';

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

  await server.register(cors, {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
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
  });

  server.get('/health', async () => {
    return { status: 'ok', service: 'Bulamu API' };
  });

  await server.register(clinicRoutes);
  await server.register(authRoutes);
  await server.register(patientRoutes);
  await server.register(appointmentRoutes);
  await server.register(consultationRoutes);
  await server.register(dashboardRoutes);
  await server.register(invoiceRoutes);
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
