-- Facility finances: itemised bills, payments with numbered receipts, and
-- expenses. Existing invoices are carried over as they stand: each becomes a
-- bill with one consultation line, and each one already marked paid gets the
-- payment it stood for (method not recorded), numbered in the order paid.

-- CreateEnum
CREATE TYPE "ChargeKind" AS ENUM ('CONSULTATION', 'LAB', 'MEDICINE', 'PROCEDURE', 'ADMISSION', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'MOBILE_MONEY', 'CARD', 'BANK', 'INSURANCE');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('MEDICINES_SUPPLIES', 'SALARIES', 'RENT', 'UTILITIES', 'EQUIPMENT', 'TRANSPORT', 'OTHER');

-- AlterTable
ALTER TABLE "Clinic" ADD COLUMN     "lastReceiptNumber" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "patientId" TEXT,
ALTER COLUMN "consultationId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "kind" "ChargeKind" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "labTestId" TEXT,
    "prescriptionId" TEXT,
    "admissionId" TEXT,
    "addedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientPayment" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "receiptNumber" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "PaymentMethod",
    "reference" TEXT,
    "payerName" TEXT,
    "receivedByUserId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedByUserId" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "spentOn" TIMESTAMP(3) NOT NULL,
    "method" "PaymentMethod",
    "paidTo" TEXT,
    "reference" TEXT,
    "recordedByUserId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedByUserId" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);


-- Every bill names its patient (until now reached through the visit).
UPDATE "Invoice" i SET "patientId" = c."patientId" FROM "Consultation" c WHERE c.id = i."consultationId";
ALTER TABLE "Invoice" ALTER COLUMN "patientId" SET NOT NULL;

-- One consultation line per existing bill.
INSERT INTO "InvoiceItem" ("id", "invoiceId", "kind", "description", "quantity", "unitPrice", "amount", "createdAt")
SELECT gen_random_uuid()::text, i.id, 'CONSULTATION', 'Consultation', 1, ROUND(i.amount)::int, ROUND(i.amount)::int, i."createdAt" FROM "Invoice" i;

-- The payment behind each bill already marked paid, receipt-numbered per facility in the order paid.
INSERT INTO "PatientPayment" ("id", "clinicId", "invoiceId", "receiptNumber", "amount", "receivedAt", "createdAt")
SELECT gen_random_uuid()::text, i."clinicId", i.id,
       ROW_NUMBER() OVER (PARTITION BY i."clinicId" ORDER BY COALESCE(i."paidAt", i."updatedAt"), i.id)::int,
       ROUND(i.amount)::int, COALESCE(i."paidAt", i."updatedAt"), COALESCE(i."paidAt", i."updatedAt")
FROM "Invoice" i WHERE i.status = 'PAID';
UPDATE "Invoice" SET "amountPaid" = amount WHERE status = 'PAID';
UPDATE "Clinic" c SET "lastReceiptNumber" = p.n FROM (SELECT "clinicId", MAX("receiptNumber") AS n FROM "PatientPayment" GROUP BY "clinicId") p WHERE p."clinicId" = c.id;

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceItem_labTestId_key" ON "InvoiceItem"("labTestId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceItem_prescriptionId_key" ON "InvoiceItem"("prescriptionId");

-- CreateIndex
CREATE INDEX "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceItem_admissionId_idx" ON "InvoiceItem"("admissionId");

-- CreateIndex
CREATE INDEX "PatientPayment_clinicId_receivedAt_idx" ON "PatientPayment"("clinicId", "receivedAt");

-- CreateIndex
CREATE INDEX "PatientPayment_invoiceId_idx" ON "PatientPayment"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PatientPayment_clinicId_receiptNumber_key" ON "PatientPayment"("clinicId", "receiptNumber");

-- CreateIndex
CREATE INDEX "Expense_clinicId_spentOn_idx" ON "Expense"("clinicId", "spentOn");

-- CreateIndex
CREATE INDEX "Invoice_patientId_idx" ON "Invoice"("patientId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_labTestId_fkey" FOREIGN KEY ("labTestId") REFERENCES "LabTest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientPayment" ADD CONSTRAINT "PatientPayment_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientPayment" ADD CONSTRAINT "PatientPayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientPayment" ADD CONSTRAINT "PatientPayment_receivedByUserId_fkey" FOREIGN KEY ("receivedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientPayment" ADD CONSTRAINT "PatientPayment_voidedByUserId_fkey" FOREIGN KEY ("voidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

