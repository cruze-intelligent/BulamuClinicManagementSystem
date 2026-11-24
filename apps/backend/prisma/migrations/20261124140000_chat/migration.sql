-- Chat: staff DMs, patient-staff threads, and admin support threads.
CREATE TYPE "ChatThreadKind" AS ENUM ('STAFF_STAFF', 'PATIENT_STAFF', 'ADMIN_SUPER');

CREATE TABLE "ChatThread" (
  "id"               TEXT        NOT NULL,
  "clinicId"         TEXT,
  "kind"             "ChatThreadKind" NOT NULL,
  "userAId"          TEXT        NOT NULL,
  "userBId"          TEXT,
  "patientAccountId" TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatThread_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatThread_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ChatThread_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ChatThread_patientAccountId_fkey" FOREIGN KEY ("patientAccountId") REFERENCES "PatientAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ChatThread_clinicId_userAId_userBId_key" ON "ChatThread"("clinicId", "userAId", "userBId");
CREATE INDEX "ChatThread_clinicId_idx" ON "ChatThread"("clinicId");
CREATE INDEX "ChatThread_patientAccountId_idx" ON "ChatThread"("patientAccountId");

CREATE TABLE "ChatMessage" (
  "id"                     TEXT        NOT NULL,
  "threadId"               TEXT        NOT NULL,
  "authorUserId"           TEXT,
  "authorPatientAccountId" TEXT,
  "body"                   TEXT        NOT NULL,
  "readAt"                 TIMESTAMP(3),
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ChatMessage_authorPatientAccountId_fkey" FOREIGN KEY ("authorPatientAccountId") REFERENCES "PatientAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ChatMessage_threadId_createdAt_idx" ON "ChatMessage"("threadId", "createdAt");
CREATE UNIQUE INDEX "ChatThread_patientAccountId_clinicId_kind_key" ON "ChatThread"("patientAccountId", "clinicId", "kind");
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_exactly_one_author_check" CHECK (("authorUserId" IS NOT NULL)::integer + ("authorPatientAccountId" IS NOT NULL)::integer = 1);
ALTER TABLE "ChatThread" ADD CONSTRAINT "ChatThread_kind_participants_check" CHECK (("kind" = 'STAFF_STAFF' AND "clinicId" IS NOT NULL AND "userBId" IS NOT NULL AND "patientAccountId" IS NULL) OR ("kind" = 'PATIENT_STAFF' AND "clinicId" IS NOT NULL AND "userBId" IS NULL AND "patientAccountId" IS NOT NULL) OR ("kind" = 'ADMIN_SUPER' AND "clinicId" IS NOT NULL AND "userBId" IS NULL AND "patientAccountId" IS NULL));
CREATE UNIQUE INDEX "ChatThread_one_admin_super_per_clinic_key" ON "ChatThread"("clinicId") WHERE "kind" = 'ADMIN_SUPER';
