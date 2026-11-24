-- Preserve the treatment-plan order for visit procedures in chart and billing views.
ALTER TABLE "VisitProcedure"
ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
