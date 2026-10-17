-- Additive: marks a demonstration facility, which is kept out of the
-- platform's figures and whose staff are never emailed.
ALTER TABLE "Clinic" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
