import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// 'query' logging prints full SQL including bound parameters - patient names,
// phone numbers, diagnoses - straight into stdout. Fine for local debugging,
// never acceptable once logs are captured by a hosting platform (Render, etc.).
export const prisma = globalForPrisma.prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['query', 'error', 'warn'],
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Prisma's unique-constraint violation (P2002) surfaces as a raw error whose
// .message includes the underlying SQL constraint text - fine for logs, not
// something to hand back to a client. Routes that create a User should catch
// this and return a clean 409 instead of leaking that message verbatim.
export function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}