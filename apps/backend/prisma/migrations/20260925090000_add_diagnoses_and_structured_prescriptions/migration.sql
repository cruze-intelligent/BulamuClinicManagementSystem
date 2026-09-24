-- Structured diagnoses and prescriptions.
--
-- Diagnoses move from a single free-text column to their own table so a
-- consultation can carry a primary diagnosis plus secondary ones, each with an
-- optional ICD-10 code and a confirmed/provisional status. Prescriptions gain
-- the fields a paper prescription has (strength, form, route, quantity,
-- instructions) and an optional link to the stock item they were prescribed
-- from. Everything is additive: the old columns stay, so records and offline
-- clients from before this change keep working.

CREATE TYPE "DiagnosisType" AS ENUM ('PRIMARY', 'SECONDARY');
CREATE TYPE "DiagnosisCertainty" AS ENUM ('CONFIRMED', 'PROVISIONAL');

ALTER TABLE "Consultation" ADD COLUMN "clinicalNotes" TEXT;

CREATE TABLE "Diagnosis" (
  "id" TEXT NOT NULL,
  "consultationId" TEXT NOT NULL,
  "icd10Code" TEXT,
  "description" TEXT NOT NULL,
  "type" "DiagnosisType" NOT NULL DEFAULT 'PRIMARY',
  "certainty" "DiagnosisCertainty" NOT NULL DEFAULT 'CONFIRMED',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Diagnosis_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Diagnosis_consultationId_idx" ON "Diagnosis"("consultationId");
CREATE INDEX "Diagnosis_icd10Code_idx" ON "Diagnosis"("icd10Code");

ALTER TABLE "Diagnosis"
  ADD CONSTRAINT "Diagnosis_consultationId_fkey"
  FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Prescription"
  ADD COLUMN "strength" TEXT,
  ADD COLUMN "form" TEXT,
  ADD COLUMN "route" TEXT,
  ADD COLUMN "quantity" INTEGER,
  ADD COLUMN "instructions" TEXT,
  ADD COLUMN "medicineId" TEXT;

CREATE INDEX "Prescription_medicineId_idx" ON "Prescription"("medicineId");

ALTER TABLE "Prescription"
  ADD CONSTRAINT "Prescription_medicineId_fkey"
  FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every existing consultation gets its recorded diagnosis as the
-- primary (uncoded, confirmed) Diagnosis row, so screens and reports can rely
-- on a consultation always having one.
INSERT INTO "Diagnosis" ("id", "consultationId", "description", "type", "certainty", "createdAt")
SELECT gen_random_uuid()::text, c."id", c."diagnosis", 'PRIMARY'::"DiagnosisType", 'CONFIRMED'::"DiagnosisCertainty", c."createdAt"
FROM "Consultation" c
WHERE NOT EXISTS (SELECT 1 FROM "Diagnosis" d WHERE d."consultationId" = c."id");
