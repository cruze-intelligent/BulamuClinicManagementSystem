-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdmissionNoteKind" ADD VALUE 'PROCEDURE';
ALTER TYPE "AdmissionNoteKind" ADD VALUE 'OPERATION_NOTE';

-- AlterTable
ALTER TABLE "AdmissionNote" ADD COLUMN     "details" JSONB;

