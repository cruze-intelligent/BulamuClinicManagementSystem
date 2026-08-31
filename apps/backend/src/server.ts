import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import dotenv from 'dotenv';
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

dotenv.config();

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
  logger: true
});

server.register(cors, {
  origin: process.env.FRONTEND_URL || 'http://localhost:3000'
});

server.register(jwt, {
  secret: jwtSecret || 'bulamu_local_development_secret'
});

server.get('/health', async () => {
  return { status: 'ok', service: 'Bulamu API' };
});

server.register(clinicRoutes);
server.register(authRoutes);
server.register(patientRoutes);
server.register(appointmentRoutes);
server.register(consultationRoutes);
server.register(dashboardRoutes);
server.register(invoiceRoutes);
server.register(userRoutes);
server.register(reportsRoutes);
server.register(inventoryRoutes);
server.register(labRoutes);
server.register(leadsRoutes);
server.register(syncRoutes);

const start = async () => {
  try {
    const port = Number(process.env.PORT || 4000);
    await server.listen({ port, host: '0.0.0.0' });
    console.log(`Bulamu API running on http://localhost:${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
