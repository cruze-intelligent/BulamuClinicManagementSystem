-- The recurring offline sync filters each of these tables by its facility or
-- patient and updatedAt. Compound indexes keep delta pulls from scanning the
-- full facility history on every refresh.
CREATE INDEX "Patient_clinicId_updatedAt_idx" ON "Patient"("clinicId", "updatedAt");
CREATE INDEX "Appointment_clinicId_updatedAt_idx" ON "Appointment"("clinicId", "updatedAt");
CREATE INDEX "Consultation_patientId_updatedAt_idx" ON "Consultation"("patientId", "updatedAt");
CREATE INDEX "LabTest_patientId_updatedAt_idx" ON "LabTest"("patientId", "updatedAt");
CREATE INDEX "Medicine_clinicId_updatedAt_idx" ON "Medicine"("clinicId", "updatedAt");
CREATE INDEX "ReproductiveHealthRecord_patientId_updatedAt_idx" ON "ReproductiveHealthRecord"("patientId", "updatedAt");
