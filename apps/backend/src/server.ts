import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import dotenv from 'dotenv';
import { clinicRoutes } from './routes/clinic.routes';
import { authRoutes } from './routes/auth.routes';
import { patientRoutes } from './routes/patient.routes';

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