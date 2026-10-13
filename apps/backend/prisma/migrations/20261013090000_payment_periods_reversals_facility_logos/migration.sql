-- Additive only: the period each payment covered, a status for payments
-- Pesapal later reverses, and facility logos.
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'REVERSED';

ALTER TABLE "Payment" ADD COLUMN "periodStart" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN "periodEnd" TIMESTAMP(3);

-- A facility's own logo for its documents.
CREATE TABLE "ClinicLogo" (
    "clinicId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicLogo_pkey" PRIMARY KEY ("clinicId")
);

ALTER TABLE "ClinicLogo" ADD CONSTRAINT "ClinicLogo_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
