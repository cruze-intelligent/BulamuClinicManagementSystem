import { prisma } from '../src/lib/prisma';

/**
 * Truncates every application table between tests, driven by the DB's own
 * catalog so newly added models (later phases) are picked up automatically.
 */
export async function resetDb() {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename != '_prisma_migrations'
  `;

  if (tables.length === 0) return;

  const quoted = tables.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE;`);
}
