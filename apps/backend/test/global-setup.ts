import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { startEmbeddedPostgres } from './embedded-db';

const backendRoot = path.resolve(__dirname, '..');
const envHandoffPath = path.join(__dirname, '.env.test.local');

export default async function globalSetup() {
  const db = await startEmbeddedPostgres();

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
