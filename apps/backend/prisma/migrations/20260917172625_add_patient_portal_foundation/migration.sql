-- CreateEnum
CREATE TYPE "PatientAccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PatientAccessGrantMethod" AS ENUM ('PIN', 'OTP');

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN "patientAccountId" TEXT;

-- CreateTable
CREATE TABLE "PatientAccount" (
    "id" TEXT NOT NULL,
    "portableId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phoneKey" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "status" "PatientAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "mustResetPassword" BOOLEAN NOT NULL DEFAULT true,
    "createdByClinicId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientAccessGrant" (
    "id" TEXT NOT NULL,
    "patientAccountId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "method" "PatientAccessGrantMethod" NOT NULL,
    "grantedByUserId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,

    CONSTRAINT "PatientAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientPasswordResetToken" (
    "id" TEXT NOT NULL,
    "patientAccountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientPasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Patient_patientAccountId_idx" ON "Patient"("patientAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "PatientAccount_portableId_key" ON "PatientAccount"("portableId");

-- CreateIndex
CREATE UNIQUE INDEX "PatientAccount_email_key" ON "PatientAccount"("email");

-- CreateIndex
CREATE INDEX "PatientAccount_phoneKey_idx" ON "PatientAccount"("phoneKey");

-- CreateIndex
CREATE INDEX "PatientAccessGrant_patientAccountId_idx" ON "PatientAccessGrant"("patientAccountId");

-- CreateIndex
CREATE INDEX "PatientAccessGrant_clinicId_idx" ON "PatientAccessGrant"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "PatientPasswordResetToken_tokenHash_key" ON "PatientPasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PatientPasswordResetToken_patientAccountId_idx" ON "PatientPasswordResetToken"("patientAccountId");

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_patientAccountId_fkey" FOREIGN KEY ("patientAccountId") REFERENCES "PatientAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientAccount" ADD CONSTRAINT "PatientAccount_createdByClinicId_fkey" FOREIGN KEY ("createdByClinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientAccessGrant" ADD CONSTRAINT "PatientAccessGrant_patientAccountId_fkey" FOREIGN KEY ("patientAccountId") REFERENCES "PatientAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientAccessGrant" ADD CONSTRAINT "PatientAccessGrant_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientPasswordResetToken" ADD CONSTRAINT "PatientPasswordResetToken_patientAccountId_fkey" FOREIGN KEY ("patientAccountId") REFERENCES "PatientAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
