-- Wards and inpatient admissions, a fuller referral (urgency, clinical summary,
-- recorded consent, the receiving facility's reply), patient-approved sharing of
-- history between facilities, who ordered each lab test, a VIEW audit action,
-- and the notification types that route each event to the right staff.
-- Additive only: every new column is nullable or has a default.

-- CreateEnum
CREATE TYPE "ReferralUrgency" AS ENUM ('ROUTINE', 'URGENT', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "WardType" AS ENUM ('GENERAL', 'MALE', 'FEMALE', 'MATERNITY', 'PAEDIATRIC', 'SURGICAL', 'ICU', 'ISOLATION', 'PRIVATE', 'OTHER');

-- CreateEnum
CREATE TYPE "AdmissionStatus" AS ENUM ('ADMITTED', 'DISCHARGED');

-- CreateEnum
CREATE TYPE "DischargeOutcome" AS ENUM ('RECOVERED', 'IMPROVED', 'REFERRED', 'LEFT_AGAINST_ADVICE', 'ABSCONDED', 'DIED');

-- CreateEnum
CREATE TYPE "AdmissionNoteKind" AS ENUM ('NURSING_NOTE', 'WARD_ROUND', 'OBSERVATION', 'TRANSFER');

-- CreateEnum
CREATE TYPE "HistoryShareStatus" AS ENUM ('REQUESTED', 'APPROVED', 'DECLINED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "HistoryConsentMethod" AS ENUM ('PIN', 'OTP', 'PORTAL');

-- AlterEnum
ALTER TYPE "ReferralStatus" ADD VALUE 'DECLINED';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'VIEW';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'OUT_OF_STOCK';
ALTER TYPE "NotificationType" ADD VALUE 'STOCK_EXPIRING';
ALTER TYPE "NotificationType" ADD VALUE 'LAB_TEST_ORDERED';
ALTER TYPE "NotificationType" ADD VALUE 'LAB_RESULT_AVAILABLE';
ALTER TYPE "NotificationType" ADD VALUE 'APPOINTMENT_BOOKED';
ALTER TYPE "NotificationType" ADD VALUE 'APPOINTMENT_CANCELLED';
ALTER TYPE "NotificationType" ADD VALUE 'REFERRAL_UPDATED';
ALTER TYPE "NotificationType" ADD VALUE 'PATIENT_ADMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'PATIENT_DISCHARGED';
ALTER TYPE "NotificationType" ADD VALUE 'HISTORY_ACCESS_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE 'REFERRAL_ISSUED';
ALTER TYPE "NotificationType" ADD VALUE 'DISCHARGE_SUMMARY_READY';
ALTER TYPE "NotificationType" ADD VALUE 'HISTORY_SHARING_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'HISTORY_ACCESS_REQUESTED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "tourCompletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Referral" ADD COLUMN     "clinicalSummary" TEXT,
ADD COLUMN     "consentRecordedAt" TIMESTAMP(3),
ADD COLUMN     "receivingPatientId" TEXT,
ADD COLUMN     "referredByUserId" TEXT,
ADD COLUMN     "respondedAt" TIMESTAMP(3),
ADD COLUMN     "respondedByUserId" TEXT,
ADD COLUMN     "responseNote" TEXT,
ADD COLUMN     "urgency" "ReferralUrgency" NOT NULL DEFAULT 'ROUTINE';

-- AlterTable
ALTER TABLE "LabTest" ADD COLUMN     "orderedByUserId" TEXT;

-- AlterTable
ALTER TABLE "PatientAccessOtp" ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'LINK';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "dedupeKey" TEXT;

-- CreateTable
CREATE TABLE "Ward" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "WardType" NOT NULL DEFAULT 'GENERAL',
    "beds" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Admission" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "wardId" TEXT NOT NULL,
    "bed" TEXT,
    "status" "AdmissionStatus" NOT NULL DEFAULT 'ADMITTED',
    "reason" TEXT NOT NULL,
    "admissionIcd10Code" TEXT,
    "attendingDoctorId" TEXT,
    "admittedByUserId" TEXT NOT NULL,
    "admittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dischargedAt" TIMESTAMP(3),
    "dischargedByUserId" TEXT,
    "outcome" "DischargeOutcome",
    "dischargeDiagnosis" TEXT,
    "dischargeIcd10Code" TEXT,
    "dischargeSummary" TEXT,
    "followUpInstructions" TEXT,
    "referralId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Admission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionNote" (
    "id" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorRole" "Role" NOT NULL,
    "kind" "AdmissionNoteKind" NOT NULL,
    "note" TEXT,
    "vitals" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdmissionNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoryShare" (
    "id" TEXT NOT NULL,
    "patientAccountId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "status" "HistoryShareStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedByUserId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "approvalMethod" "HistoryConsentMethod",
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "HistoryShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Ward_clinicId_name_key" ON "Ward"("clinicId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Admission_referralId_key" ON "Admission"("referralId");

-- CreateIndex
CREATE INDEX "Admission_clinicId_status_idx" ON "Admission"("clinicId", "status");

-- CreateIndex
CREATE INDEX "Admission_wardId_status_idx" ON "Admission"("wardId", "status");

-- CreateIndex
CREATE INDEX "Admission_patientId_idx" ON "Admission"("patientId");

-- CreateIndex
CREATE INDEX "AdmissionNote_admissionId_createdAt_idx" ON "AdmissionNote"("admissionId", "createdAt");

-- CreateIndex
CREATE INDEX "HistoryShare_patientAccountId_status_idx" ON "HistoryShare"("patientAccountId", "status");

-- CreateIndex
CREATE INDEX "HistoryShare_clinicId_status_idx" ON "HistoryShare"("clinicId", "status");

-- CreateIndex
CREATE INDEX "Notification_clinicId_dedupeKey_idx" ON "Notification"("clinicId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referredByUserId_fkey" FOREIGN KEY ("referredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ward" ADD CONSTRAINT "Ward_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_wardId_fkey" FOREIGN KEY ("wardId") REFERENCES "Ward"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_attendingDoctorId_fkey" FOREIGN KEY ("attendingDoctorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_admittedByUserId_fkey" FOREIGN KEY ("admittedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_dischargedByUserId_fkey" FOREIGN KEY ("dischargedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionNote" ADD CONSTRAINT "AdmissionNote_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionNote" ADD CONSTRAINT "AdmissionNote_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoryShare" ADD CONSTRAINT "HistoryShare_patientAccountId_fkey" FOREIGN KEY ("patientAccountId") REFERENCES "PatientAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoryShare" ADD CONSTRAINT "HistoryShare_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Everyone who has already been using Bulamu has seen the walkthrough (it used
-- to open on every sign-in): mark it done, so it opens by itself only for
-- people signing in for the first time.
UPDATE "User" SET "tourCompletedAt" = NOW() WHERE "lastLoginAt" IS NOT NULL;
