import EmbeddedPostgres from 'embedded-postgres';
import path from 'path';
import os from 'os';
import fs from 'fs';
import net from 'net';

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Could not determine a free port')));
      }
    });
  });
}

/**
 * Spins up a real, self-contained Postgres instance (no Docker, no system
 * install) for local dev/test use. Data directory lives in the OS temp dir
 * so nothing needs to be gitignored or cleaned up in the repo itself.
 *
 * Picks a fresh, currently-free port on every call rather than a fixed one -
 * teardown of the previous instance isn't always instant on Windows, so a
 * fixed port risks colliding with a not-yet-released prior run.
 */
export async function startEmbeddedPostgres(opts?: { port?: number; databaseName?: string }) {
  const port = opts?.port ?? (await findFreePort());
  const databaseName = opts?.databaseName ?? 'bulamu_test';
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bulamu-pg-'));

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'bulamu_test',
    password: 'bulamu_test',
    port,
    persistent: false,
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase(databaseName);

  const connectionString = `postgresql://bulamu_test:bulamu_test@localhost:${port}/${databaseName}?schema=public`;

  return {
    connectionString,
    stop: async () => {
      await pg.stop();
      // Windows sometimes keeps a brief file lock on the data dir right after
      // the postgres process exits; retry a few times rather than failing teardown.
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          fs.rmSync(dataDir, { recursive: true, force: true });
          break;
        } catch (err) {
          if (attempt === 4) {
            console.warn(`Could not remove temp Postgres data dir ${dataDir}:`, err);
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
    },
  };
}
