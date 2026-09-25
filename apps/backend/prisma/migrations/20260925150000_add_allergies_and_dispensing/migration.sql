-- Allergies on the patient record, and dispensing on prescriptions.
-- Additive only: existing patients start as UNKNOWN (nobody has asked yet) and
-- existing prescriptions as not yet dispensed.

CREATE TYPE "AllergyStatus" AS ENUM ('UNKNOWN', 'NONE_KNOWN', 'KNOWN');

ALTER TABLE "Patient"
  ADD COLUMN "allergyStatus" "AllergyStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "allergies" JSONB,
  ADD COLUMN "allergiesUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "allergiesUpdatedBy" TEXT;

ALTER TABLE "Prescription"
  ADD COLUMN "allergyOverride" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "dispensedAt" TIMESTAMP(3),
  ADD COLUMN "dispensedByUserId" TEXT,
  ADD COLUMN "dispensedQuantity" INTEGER;

CREATE INDEX "Prescription_dispensedAt_idx" ON "Prescription"("dispensedAt");

ALTER TABLE "Prescription"
  ADD CONSTRAINT "Prescription_dispensedByUserId_fkey"
  FOREIGN KEY ("dispensedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Prescriptions written before dispensing existed have no record of whether they
-- were handed out, so they must not appear as a queue of pending work. Mark them
-- dispensed as of when they were written, with no quantity and no stock change.
UPDATE "Prescription" SET "dispensedAt" = "createdAt" WHERE "dispensedAt" IS NULL;
