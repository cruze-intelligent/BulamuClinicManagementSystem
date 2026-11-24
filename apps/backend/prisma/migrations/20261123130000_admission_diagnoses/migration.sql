-- The working diagnoses of a ward stay, updated on ward rounds.
ALTER TABLE "Admission" ADD COLUMN "diagnoses" JSONB;
