-- AlterEnum
ALTER TYPE "PatientAccountStatus" ADD VALUE 'CLOSED';

-- AlterTable
ALTER TABLE "PatientAccount" ADD COLUMN "closedAt" TIMESTAMP(3);
