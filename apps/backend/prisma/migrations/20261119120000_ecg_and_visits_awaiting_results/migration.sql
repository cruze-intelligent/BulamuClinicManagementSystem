-- Electrocardiography (ECG/EKG) requested and reported with imaging.
ALTER TYPE "ImagingModality" ADD VALUE IF NOT EXISTS 'ECG';

-- A visit saved with tests sent and the diagnosis and prescription still to come.
ALTER TABLE "Consultation" ADD COLUMN "awaitingResults" BOOLEAN NOT NULL DEFAULT false;
