ALTER TYPE "StockMovementKind" ADD VALUE 'ADMINISTERED';

ALTER TABLE "InpatientMedicationOrder"
  ADD COLUMN "medicineId" TEXT;

ALTER TABLE "MedicationAdministration"
  ADD COLUMN "stockQuantity" INTEGER;

ALTER TABLE "InvoiceItem"
  ADD COLUMN "medicationAdministrationId" TEXT;

CREATE UNIQUE INDEX "InvoiceItem_medicationAdministrationId_key"
  ON "InvoiceItem"("medicationAdministrationId");

CREATE INDEX "InpatientMedicationOrder_medicineId_idx"
  ON "InpatientMedicationOrder"("medicineId");

ALTER TABLE "InpatientMedicationOrder"
  ADD CONSTRAINT "InpatientMedicationOrder_medicineId_fkey"
  FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InvoiceItem"
  ADD CONSTRAINT "InvoiceItem_medicationAdministrationId_fkey"
  FOREIGN KEY ("medicationAdministrationId") REFERENCES "MedicationAdministration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
