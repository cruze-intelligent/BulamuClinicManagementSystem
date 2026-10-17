-- Additive: a Laboratory Technician role; who entered and who verified each lab result, and who recorded
-- each visit. Existing rows stay as they are (empty = not recorded then).
ALTER TABLE "LabTest" ADD COLUMN "resultedByUserId" TEXT;
ALTER TABLE "LabTest" ADD COLUMN "resultedAt" TIMESTAMP(3);
ALTER TABLE "LabTest" ADD COLUMN "verifiedByUserId" TEXT;
ALTER TABLE "LabTest" ADD COLUMN "verifiedAt" TIMESTAMP(3);
ALTER TABLE "Consultation" ADD COLUMN "recordedByUserId" TEXT;

ALTER TABLE "LabTest" ADD CONSTRAINT "LabTest_resultedByUserId_fkey" FOREIGN KEY ("resultedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LabTest" ADD CONSTRAINT "LabTest_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'LAB_TECH';
