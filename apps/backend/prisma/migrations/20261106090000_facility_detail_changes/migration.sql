-- CreateEnum
CREATE TYPE "FacilityChangeStatus" AS ENUM ('APPLIED', 'PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "FacilityDetailChange" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "status" "FacilityChangeStatus" NOT NULL,
    "note" TEXT,
    "requestedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacilityDetailChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FacilityDetailChange_clinicId_createdAt_idx" ON "FacilityDetailChange"("clinicId", "createdAt");

-- CreateIndex
CREATE INDEX "FacilityDetailChange_status_createdAt_idx" ON "FacilityDetailChange"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "FacilityDetailChange" ADD CONSTRAINT "FacilityDetailChange_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

