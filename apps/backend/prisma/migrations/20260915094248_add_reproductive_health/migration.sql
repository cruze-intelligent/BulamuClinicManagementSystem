-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('FEMALE', 'MALE', 'OTHER');

-- CreateEnum
CREATE TYPE "FamilyPlanningMethod" AS ENUM ('NONE', 'CONDOM', 'PILL', 'INJECTABLE', 'IMPLANT', 'IUD', 'NATURAL', 'PERMANENT', 'OTHER');

-- CreateEnum
CREATE TYPE "PregnancyStatus" AS ENUM ('UNKNOWN', 'NOT_PREGNANT', 'PREGNANT', 'POSTPARTUM');

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "district" TEXT,
ADD COLUMN     "nextOfKinName" TEXT,
ADD COLUMN     "nextOfKinPhone" TEXT,
ADD COLUMN     "parish" TEXT,
ADD COLUMN     "sex" "Sex",
ADD COLUMN     "subCounty" TEXT,
ADD COLUMN     "village" TEXT;

-- CreateTable
CREATE TABLE "ReproductiveHealthRecord" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "lastMenstrualPeriodDate" TIMESTAMP(3),
    "cycleLengthDays" INTEGER,
    "flowDurationDays" INTEGER,
    "familyPlanningMethod" "FamilyPlanningMethod" NOT NULL DEFAULT 'NONE',
    "pregnancyStatus" "PregnancyStatus" NOT NULL DEFAULT 'UNKNOWN',
    "gravida" INTEGER,
    "para" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReproductiveHealthRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReproductiveHealthRecord_patientId_idx" ON "ReproductiveHealthRecord"("patientId");

-- AddForeignKey
ALTER TABLE "ReproductiveHealthRecord" ADD CONSTRAINT "ReproductiveHealthRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReproductiveHealthRecord" ADD CONSTRAINT "ReproductiveHealthRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
