-- AlterEnum
ALTER TYPE "DocumentCategory" ADD VALUE 'PATIENT_UPLOAD';

-- CreateEnum
CREATE TYPE "AppointmentRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Document" ALTER COLUMN "uploadedByUserId" DROP NOT NULL;
ALTER TABLE "Document" ADD COLUMN "uploadedByPatientAccountId" TEXT;

-- CreateTable
CREATE TABLE "AppointmentRequest" (
    "id" TEXT NOT NULL,
    "patientAccountId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "preferredDate" TIMESTAMP(3) NOT NULL,
    "preferredTime" TEXT,
    "reason" TEXT,
    "status" "AppointmentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "resultingAppointmentId" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppointmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Document_uploadedByPatientAccountId_idx" ON "Document"("uploadedByPatientAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentRequest_resultingAppointmentId_key" ON "AppointmentRequest"("resultingAppointmentId");

-- CreateIndex
CREATE INDEX "AppointmentRequest_clinicId_status_idx" ON "AppointmentRequest"("clinicId", "status");

-- CreateIndex
CREATE INDEX "AppointmentRequest_patientAccountId_idx" ON "AppointmentRequest"("patientAccountId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedByPatientAccountId_fkey" FOREIGN KEY ("uploadedByPatientAccountId") REFERENCES "PatientAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentRequest" ADD CONSTRAINT "AppointmentRequest_patientAccountId_fkey" FOREIGN KEY ("patientAccountId") REFERENCES "PatientAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentRequest" ADD CONSTRAINT "AppointmentRequest_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentRequest" ADD CONSTRAINT "AppointmentRequest_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentRequest" ADD CONSTRAINT "AppointmentRequest_resultingAppointmentId_fkey" FOREIGN KEY ("resultingAppointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentRequest" ADD CONSTRAINT "AppointmentRequest_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
