import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { appointmentRoutes } from './routes/appointment.routes';
import { authRoutes } from './routes/auth.routes';
import { clinicRoutes } from './routes/clinic.routes';
import { consultationRoutes } from './routes/consultation.routes';
import { dashboardRoutes } from './routes/dashboard.routes';
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

  return server;
}
