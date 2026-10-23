import dotenv from 'dotenv';
import { buildApp } from './app';
import { sweepLapsedSubscriptions } from './lib/subscription';
import { adoptLegacyFiles } from './lib/storage';
import { prisma } from './lib/prisma';

dotenv.config();

// Ended trials and paid periods are marked past due (and the operator told)
// even when nobody at the facility has used Bulamu since. The server sleeps
// when idle on the hosting plan, so this also runs at every start-up.
const LAPSE_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

const start = async () => {
  try {
    const server = await buildApp();
    const port = Number(process.env.PORT || 4000);
    await server.listen({ port, host: '0.0.0.0' });
    console.log(`Bulamu API running on http://localhost:${port}`);
    void sweepLapsedSubscriptions();
    setInterval(() => void sweepLapsedSubscriptions(), LAPSE_SWEEP_INTERVAL_MS).unref();
    // Documents an earlier version kept on this machine's disk move into the database.
    void adoptLegacyFiles().catch((error) => console.error('[storage] moving files from disk failed', error));

    // Render stops the old server with SIGTERM on every deploy and restart (and
    // allows it 30 seconds). Stop taking new requests, let the ones under way
    // finish - a payment being recorded, a file being saved - then close the
    // database connections cleanly.
    let stopping = false;
    const stop = async (signal: string) => {
      if (stopping) return;
      stopping = true;
      console.log(`${signal} received - finishing requests under way, then stopping`);
      const forceExit = setTimeout(() => process.exit(1), 25_000);
      forceExit.unref();
      try {
        await server.close();
        await prisma.$disconnect();
      } finally {
        process.exit(0);
      }
    };
    process.on('SIGTERM', () => void stop('SIGTERM'));
    process.on('SIGINT', () => void stop('SIGINT'));
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();
