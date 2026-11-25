ALTER TYPE "NotificationType" ADD VALUE 'NEW_INPATIENT_MEDICATION_ORDER';

CREATE TYPE "InpatientMedicationOrderStatus" AS ENUM ('ACTIVE', 'STOPPED');
CREATE TYPE "MedicationAdministrationStatus" AS ENUM ('GIVEN', 'REFUSED', 'WITHHELD', 'NOT_AVAILABLE');

CREATE TABLE "InpatientMedicationOrder" (
    "id" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "prescribedByUserId" TEXT NOT NULL,
    "medication" TEXT NOT NULL,
    "strength" TEXT,
    "dose" TEXT NOT NULL,
    "route" TEXT,
    "frequency" TEXT NOT NULL,
    "duration" TEXT,
    "instructions" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "InpatientMedicationOrderStatus" NOT NULL DEFAULT 'ACTIVE',
    "stoppedAt" TIMESTAMP(3),
    "stopReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InpatientMedicationOrder_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InpatientMedicationOrder_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InpatientMedicationOrder_prescribedByUserId_fkey" FOREIGN KEY ("prescribedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "MedicationAdministration" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "givenByUserId" TEXT NOT NULL,
    "status" "MedicationAdministrationStatus" NOT NULL,
    "doseGiven" TEXT,
    "routeGiven" TEXT,
    "administeredAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MedicationAdministration_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MedicationAdministration_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "InpatientMedicationOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MedicationAdministration_givenByUserId_fkey" FOREIGN KEY ("givenByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "InpatientMedicationOrder_admissionId_status_startAt_idx" ON "InpatientMedicationOrder"("admissionId", "status", "startAt");
CREATE INDEX "MedicationAdministration_orderId_administeredAt_idx" ON "MedicationAdministration"("orderId", "administeredAt");
CREATE INDEX "MedicationAdministration_givenByUserId_administeredAt_idx" ON "MedicationAdministration"("givenByUserId", "administeredAt");
