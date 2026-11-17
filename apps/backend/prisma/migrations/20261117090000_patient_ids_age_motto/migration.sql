-- AlterTable
ALTER TABLE "Clinic" ADD COLUMN     "lastPatientNumber" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "motto" TEXT;

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "dateOfBirthEstimated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "patientNumber" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Patient_clinicId_patientNumber_key" ON "Patient"("clinicId", "patientNumber");


-- Every patient already registered gets their facility's next Patient ID, in
-- the order they were registered (removed records keep theirs, so a number
-- is never given twice); each facility then carries on from its highest.
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "clinicId" ORDER BY "createdAt", id) AS n
  FROM "Patient"
)
UPDATE "Patient" p SET "patientNumber" = numbered.n FROM numbered WHERE p.id = numbered.id;

UPDATE "Clinic" c SET "lastPatientNumber" = COALESCE((SELECT MAX(p."patientNumber") FROM "Patient" p WHERE p."clinicId" = c.id), 0);

-- From now on the database issues the number itself as each patient is
-- registered - however the record arrives (the app, an offline device
-- syncing, a referral, a portal link) - taking the facility's counter under
-- its row lock, so two registrations at once never share a number.
CREATE OR REPLACE FUNCTION assign_patient_number() RETURNS trigger AS $$
BEGIN
  IF NEW."patientNumber" IS NULL THEN
    UPDATE "Clinic" SET "lastPatientNumber" = "lastPatientNumber" + 1
      WHERE id = NEW."clinicId"
      RETURNING "lastPatientNumber" INTO NEW."patientNumber";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER patient_number BEFORE INSERT ON "Patient"
  FOR EACH ROW EXECUTE FUNCTION assign_patient_number();
