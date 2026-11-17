-- Imaging requests (X-ray, ultrasound, CT...), the radiographer / sonographer role, and their notifications.
CREATE TYPE "ImagingModality" AS ENUM ('XRAY', 'ULTRASOUND', 'CT', 'MRI', 'MAMMOGRAPHY', 'FLUOROSCOPY', 'OTHER');
CREATE TYPE "ImagingStatus" AS ENUM ('REQUESTED', 'REPORTED', 'CANCELLED');

ALTER TYPE "NotificationType" ADD VALUE 'IMAGING_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'IMAGING_REPORTED';
ALTER TYPE "Role" ADD VALUE 'RADIOGRAPHER';

CREATE TABLE "ImagingRequest" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "consultationId" TEXT,
    "departmentId" TEXT,
    "modality" "ImagingModality" NOT NULL,
    "examination" TEXT NOT NULL,
    "clinicalInfo" TEXT,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "status" "ImagingStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedBy" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "findings" TEXT,
    "impression" TEXT,
    "reportedBy" TEXT,
    "reportedByUserId" TEXT,
    "reportedAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImagingRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImagingRequest_clinicId_status_idx" ON "ImagingRequest"("clinicId", "status");
CREATE INDEX "ImagingRequest_patientId_idx" ON "ImagingRequest"("patientId");
CREATE INDEX "ImagingRequest_consultationId_idx" ON "ImagingRequest"("consultationId");

ALTER TABLE "ImagingRequest" ADD CONSTRAINT "ImagingRequest_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImagingRequest" ADD CONSTRAINT "ImagingRequest_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImagingRequest" ADD CONSTRAINT "ImagingRequest_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ImagingRequest" ADD CONSTRAINT "ImagingRequest_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A patient who stepped out of the waiting queue for a while keeps their place by arrival time.
ALTER TABLE "Appointment" ADD COLUMN "awayAt" TIMESTAMP(3);
