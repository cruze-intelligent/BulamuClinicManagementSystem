-- The facility's units (departments / clinics): General OPD, Dentistry, Orthopaedics...
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Department_clinicId_name_key" ON "Department"("clinicId", "name");
CREATE UNIQUE INDEX "Department_clinicId_code_key" ON "Department"("clinicId", "code");

ALTER TABLE "Department" ADD CONSTRAINT "Department_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The units each member of staff works in (none: they work across the facility).
ALTER TABLE "User" ADD COLUMN "departmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- The unit a visit belongs to, and the unit a ward belongs to.
ALTER TABLE "Appointment" ADD COLUMN "departmentId" TEXT;
ALTER TABLE "Ward" ADD COLUMN "departmentId" TEXT;

CREATE INDEX "Appointment_clinicId_departmentId_idx" ON "Appointment"("clinicId", "departmentId");

ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Ward" ADD CONSTRAINT "Ward_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
