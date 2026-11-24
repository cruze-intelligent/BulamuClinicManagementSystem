-- Procedures done or planned at an outpatient visit, and the bill line each was charged on.
CREATE TABLE "VisitProcedure" (
    "id" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitProcedure_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VisitProcedure_consultationId_idx" ON "VisitProcedure"("consultationId");

ALTER TABLE "VisitProcedure" ADD CONSTRAINT "VisitProcedure_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvoiceItem" ADD COLUMN "visitProcedureId" TEXT;

CREATE UNIQUE INDEX "InvoiceItem_visitProcedureId_key" ON "InvoiceItem"("visitProcedureId");

ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_visitProcedureId_fkey" FOREIGN KEY ("visitProcedureId") REFERENCES "VisitProcedure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
