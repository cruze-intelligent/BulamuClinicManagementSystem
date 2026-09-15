-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'ACCEPTED', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Clinic" ADD COLUMN     "district" TEXT,
ADD COLUMN     "parentFacilityId" TEXT,
ADD COLUMN     "parish" TEXT,
ADD COLUMN     "subCounty" TEXT;

-- AlterTable
ALTER TABLE "Consultation" ADD COLUMN     "serviceTags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "fromClinicId" TEXT NOT NULL,
    "toClinicId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Referral_fromClinicId_idx" ON "Referral"("fromClinicId");

-- CreateIndex
CREATE INDEX "Referral_toClinicId_idx" ON "Referral"("toClinicId");

-- CreateIndex
CREATE INDEX "Referral_patientId_idx" ON "Referral"("patientId");

-- AddForeignKey
ALTER TABLE "Clinic" ADD CONSTRAINT "Clinic_parentFacilityId_fkey" FOREIGN KEY ("parentFacilityId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_fromClinicId_fkey" FOREIGN KEY ("fromClinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_toClinicId_fkey" FOREIGN KEY ("toClinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
