import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';

dotenv.config();

const server = Fastify({
  logger: true
});

// Register CORS
server.register(cors, {
  origin: process.env.FRONTEND_URL || 'http://localhost:3000'
});

// Health check route
server.get('/health', async (request, reply) => {
  return { status: 'ok', service: 'Bulamu API' };
});

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

