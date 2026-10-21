import dotenv from 'dotenv';
import { buildApp } from './app';
import { sweepLapsedSubscriptions } from './lib/subscription';
import { adoptLegacyFiles } from './lib/storage';

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
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();
