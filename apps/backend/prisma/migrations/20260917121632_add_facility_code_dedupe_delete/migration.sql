-- AlterTable: add nullable columns first so existing rows can be backfilled
ALTER TABLE "Clinic" ADD COLUMN "facilityCode" TEXT;
ALTER TABLE "Clinic" ADD COLUMN "phoneKey" TEXT;
ALTER TABLE "Clinic" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Clinic" ADD COLUMN "deletedBy" TEXT;

-- Backfill facilityCode for existing rows from their (already-unique) id,
-- and phoneKey from their existing phone number.
UPDATE "Clinic" SET "facilityCode" = 'BLM-' || UPPER(SUBSTRING(REPLACE(id::text, '-', ''), 1, 8)) WHERE "facilityCode" IS NULL;
UPDATE "Clinic" SET "phoneKey" = RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 9) WHERE "phoneKey" IS NULL;

-- Now that every row has a value, enforce NOT NULL + uniqueness
ALTER TABLE "Clinic" ALTER COLUMN "facilityCode" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Clinic_facilityCode_key" ON "Clinic"("facilityCode");
CREATE INDEX "Clinic_phoneKey_idx" ON "Clinic"("phoneKey");
