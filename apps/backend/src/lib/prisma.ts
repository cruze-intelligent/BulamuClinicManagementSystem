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