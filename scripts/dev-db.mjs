import EmbeddedPostgres from 'embedded-postgres';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const dataDir = path.join(repoRoot, '.data', 'postgres-dev');

const port = 5432;
const user = 'bulamu_user';
const password = 'bulamu_local_password';
const databaseName = 'bulamu';

fs.mkdirSync(path.dirname(dataDir), { recursive: true });

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user,
  password,
  port,
  persistent: true,
});

const alreadyInitialised = fs.existsSync(path.join(dataDir, 'PG_VERSION'));

await pg.initialise();
await pg.start();

if (!alreadyInitialised) {
  await pg.createDatabase(databaseName);
}

console.log(`[dev-db] Postgres ready at postgresql://${user}:${password}@localhost:${port}/${databaseName}?schema=public`);
console.log('[dev-db] Data persisted at .data/postgres-dev (gitignored). Press Ctrl+C to stop.');

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[dev-db] Stopping Postgres...');
  await pg.stop();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Keep the process (and the Postgres child process it owns) alive indefinitely.
await new Promise(() => {});
