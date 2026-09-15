-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DEACTIVATE', 'DELETE');

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Consultation" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "LabTest" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Medicine" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "consentGivenAt" TIMESTAMP(3),
ADD COLUMN     "consentGivenBy" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ReproductiveHealthRecord" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dhis2Integration" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "encryptedPassword" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "dataElementMap" JSONB NOT NULL DEFAULT '{}',
    "lastPushedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dhis2Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncConflictLog" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "mutationId" TEXT NOT NULL,
    "incomingUpdatedAt" TIMESTAMP(3) NOT NULL,
    "currentUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncConflictLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Dhis2Integration_clinicId_key" ON "Dhis2Integration"("clinicId");

-- CreateIndex
CREATE INDEX "SyncConflictLog_clinicId_idx" ON "SyncConflictLog"("clinicId");

-- CreateIndex
CREATE INDEX "SyncConflictLog_recordId_idx" ON "SyncConflictLog"("recordId");

-- CreateIndex
CREATE INDEX "AuditLog_clinicId_idx" ON "AuditLog"("clinicId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_recordId_idx" ON "AuditLog"("entity", "recordId");

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dhis2Integration" ADD CONSTRAINT "Dhis2Integration_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
