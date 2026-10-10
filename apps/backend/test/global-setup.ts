import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import asyncExitHook from 'async-exit-hook';
import { startEmbeddedPostgres } from './embedded-db';

const backendRoot = path.resolve(__dirname, '..');
const envHandoffPath = path.join(__dirname, '.env.test.local');

export default async function globalSetup() {
  const db = await startEmbeddedPostgres();

  // embedded-postgres installs async-exit-hook, which calls process.exit(0) on
  // 'beforeExit'. That runs after vitest has set a failing exit code, and
  // replaces it with 0 - so a run with failing tests used to pass in CI. The
  // database is stopped explicitly below, so the hook is not needed for that
  // event (its signal handlers stay, for Ctrl+C).
  asyncExitHook.unhookEvent('beforeExit');

  fs.writeFileSync(envHandoffPath, `DATABASE_URL=${db.connectionString}\n`, 'utf-8');

  execSync('npx prisma migrate deploy', {
    cwd: backendRoot,
    env: { ...process.env, DATABASE_URL: db.connectionString },
    stdio: 'inherit',
  });

  return async () => {
    if (fs.existsSync(envHandoffPath)) {
      fs.rmSync(envHandoffPath);
    }
    await db.stop();
  };
}
