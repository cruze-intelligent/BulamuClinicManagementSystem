-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('LAB_RESULT_READY', 'LOW_STOCK', 'NEW_PRESCRIPTION', 'APPOINTMENT_REQUESTED', 'APPOINTMENT_CONFIRMED', 'APPOINTMENT_DECLINED', 'REFERRAL_RECEIVED', 'RECORD_ACCESS_GRANTED', 'NEW_NOTE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailOptOuts" "NotificationType"[] DEFAULT ARRAY[]::"NotificationType"[];

-- AlterTable
ALTER TABLE "PatientAccount" ADD COLUMN "emailOptOuts" "NotificationType"[] DEFAULT ARRAY[]::"NotificationType"[];

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "patientAccountId" TEXT,
    "clinicId" TEXT,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_patientAccountId_createdAt_idx" ON "Notification"("patientAccountId", "createdAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_patientAccountId_fkey" FOREIGN KEY ("patientAccountId") REFERENCES "PatientAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
