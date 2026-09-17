-- CreateTable
CREATE TABLE "PatientAccessOtp" (
    "id" TEXT NOT NULL,
    "patientAccountId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientAccessOtp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatientAccessOtp_patientAccountId_clinicId_idx" ON "PatientAccessOtp"("patientAccountId", "clinicId");

-- AddForeignKey
ALTER TABLE "PatientAccessOtp" ADD CONSTRAINT "PatientAccessOtp_patientAccountId_fkey" FOREIGN KEY ("patientAccountId") REFERENCES "PatientAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientAccessOtp" ADD CONSTRAINT "PatientAccessOtp_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
