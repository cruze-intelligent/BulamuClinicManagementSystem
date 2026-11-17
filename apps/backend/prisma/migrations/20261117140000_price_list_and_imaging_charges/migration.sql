-- Imaging examinations go on bills as their own kind of charge.
ALTER TYPE "ChargeKind" ADD VALUE 'IMAGING';

-- A bill line can charge for an imaging examination, or a procedure or operation done on the ward (each billed once).
ALTER TABLE "InvoiceItem" ADD COLUMN "imagingRequestId" TEXT;
ALTER TABLE "InvoiceItem" ADD COLUMN "admissionNoteId" TEXT;
CREATE UNIQUE INDEX "InvoiceItem_imagingRequestId_key" ON "InvoiceItem"("imagingRequestId");
CREATE UNIQUE INDEX "InvoiceItem_admissionNoteId_key" ON "InvoiceItem"("admissionNoteId");
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_imagingRequestId_fkey" FOREIGN KEY ("imagingRequestId") REFERENCES "ImagingRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_admissionNoteId_fkey" FOREIGN KEY ("admissionNoteId") REFERENCES "AdmissionNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The facility's price list.
CREATE TABLE "ServicePrice" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "kind" "ChargeKind" NOT NULL,
    "name" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServicePrice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ServicePrice_clinicId_kind_name_key" ON "ServicePrice"("clinicId", "kind", "name");
ALTER TABLE "ServicePrice" ADD CONSTRAINT "ServicePrice_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
