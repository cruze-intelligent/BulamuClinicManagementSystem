import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import dotenv from 'dotenv';
import { clinicRoutes } from './routes/clinic.routes';
import { authRoutes } from './routes/auth.routes';
import { patientRoutes } from './routes/patient.routes';
import { appointmentRoutes } from './routes/appointment.routes';
import { consultationRoutes } from './routes/consultation.routes';
import { dashboardRoutes } from './routes/dashboard.routes';
import { invoiceRoutes } from './routes/invoice.routes';
import { userRoutes } from './routes/user.routes';
import { reportsRoutes } from './routes/reports.routes';
import { inventoryRoutes } from './routes/inventory.routes';
import { labRoutes } from './routes/lab.routes';
import { leadsRoutes } from './routes/leads.routes';
import { syncRoutes } from './routes/sync.routes';

dotenv.config();

const server = Fastify({
  logger: true
});

server.register(cors, {
  origin: process.env.FRONTEND_URL || 'http://localhost:3000'
});

server.register(jwt, {
  secret: process.env.JWT_SECRET || 'fallback_secret'
});

// Health check
server.get('/health', async (request, reply) => {
  return { status: 'ok', service: 'Bulamu API' };
});

// Register routes
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


// Start server

const start = async () => {
  try {
    await server.listen({ port: 4000, host: '0.0.0.0' });
    console.log('🏥 Bulamu API running on http://localhost:4000');
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();