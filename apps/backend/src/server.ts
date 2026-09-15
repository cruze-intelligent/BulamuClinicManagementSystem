import dotenv from 'dotenv';
import { buildApp } from './app';

dotenv.config();

const start = async () => {
  try {
    const server = await buildApp();
    const port = Number(process.env.PORT || 4000);
    await server.listen({ port, host: '0.0.0.0' });
    console.log(`Bulamu API running on http://localhost:${port}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();
