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
  // Work the last test left running in the background (a receipt being emailed,
  // a notification written) can hold a lock the truncate needs: Postgres then
  // cancels one of them as a deadlock. Try again once that work has finished.
  for (let attempt = 1; ; attempt += 1) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE;`);
      return;
    } catch (error: any) {
      if (attempt >= 5 || !/deadlock detected|40P01/.test(String(error?.message))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
  }
}
