-- Lab results entered value by value, with reference ranges and flags, and the lab's comment.
ALTER TABLE "LabTest" ADD COLUMN "values" JSONB;
ALTER TABLE "LabTest" ADD COLUMN "comment" TEXT;
