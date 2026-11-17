-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "checkedInAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Consultation" ADD COLUMN     "examination" TEXT,
ADD COLUMN     "history" TEXT,
ADD COLUMN     "vitals" JSONB;

-- CreateIndex
CREATE INDEX "Appointment_clinicId_checkedInAt_idx" ON "Appointment"("clinicId", "checkedInAt");

