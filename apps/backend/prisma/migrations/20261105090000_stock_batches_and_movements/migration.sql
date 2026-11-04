-- Stock control: medicine batches (each with its own expiry), a history of every
-- stock movement, and medicine sold over the counter linked to its stock item.

-- CreateEnum
CREATE TYPE "StockMovementKind" AS ENUM ('OPENING', 'RECEIVED', 'DISPENSED', 'DISPENSE_REVERSED', 'SOLD', 'SALE_REVERSED', 'REMOVED', 'COUNTED', 'DISCONTINUED');

-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN     "medicineId" TEXT;

-- CreateTable
CREATE TABLE "MedicineBatch" (
    "id" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "supplier" TEXT,
    "reference" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicineBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "kind" "StockMovementKind" NOT NULL,
    "change" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" TEXT,
    "note" TEXT,
    "supplier" TEXT,
    "reference" TEXT,
    "expiryDate" TIMESTAMP(3),
    "unitCost" INTEGER,
    "batches" JSONB,
    "prescriptionId" TEXT,
    "invoiceItemId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MedicineBatch_medicineId_idx" ON "MedicineBatch"("medicineId");

-- CreateIndex
CREATE INDEX "StockMovement_medicineId_createdAt_idx" ON "StockMovement"("medicineId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_clinicId_createdAt_idx" ON "StockMovement"("clinicId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_prescriptionId_idx" ON "StockMovement"("prescriptionId");

-- CreateIndex
CREATE INDEX "StockMovement_invoiceItemId_idx" ON "StockMovement"("invoiceItemId");

-- AddForeignKey
ALTER TABLE "MedicineBatch" ADD CONSTRAINT "MedicineBatch_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Stock already on the shelf becomes its first batch (with the expiry date it
-- had) and the first line of its history.
INSERT INTO "MedicineBatch" ("id", "medicineId", "clinicId", "quantity", "expiryDate", "receivedAt")
SELECT gen_random_uuid()::text, m."id", m."clinicId", m."quantity", m."expiryDate", m."createdAt"
FROM "Medicine" m
WHERE m."quantity" > 0;

INSERT INTO "StockMovement" ("id", "clinicId", "medicineId", "kind", "change", "balanceAfter", "note", "expiryDate", "createdAt")
SELECT gen_random_uuid()::text, m."clinicId", m."id", 'OPENING', m."quantity", m."quantity", 'On the shelf when stock history began', m."expiryDate", CURRENT_TIMESTAMP
FROM "Medicine" m;
