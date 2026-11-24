-- Group conversations, facility and role rooms, and personal inbox pins.
CREATE TYPE "ChatGroupType" AS ENUM ('FACILITY', 'ROLE', 'CUSTOM');

ALTER TABLE "ChatThread"
  ADD COLUMN "groupType" "ChatGroupType",
  ADD COLUMN "groupName" TEXT,
  ADD COLUMN "groupRole" "Role";

ALTER TABLE "ChatThread" DROP CONSTRAINT "ChatThread_kind_participants_check";
ALTER TABLE "ChatThread" ADD CONSTRAINT "ChatThread_kind_participants_check" CHECK (
  ("kind" = 'STAFF_STAFF' AND "clinicId" IS NOT NULL AND "userBId" IS NOT NULL AND "patientAccountId" IS NULL AND "groupType" IS NULL AND "groupName" IS NULL AND "groupRole" IS NULL)
  OR ("kind" = 'STAFF_GROUP' AND "clinicId" IS NOT NULL AND "userBId" IS NULL AND "patientAccountId" IS NULL AND "groupType" IS NOT NULL AND "groupName" IS NOT NULL AND (("groupType" = 'ROLE' AND "groupRole" IS NOT NULL AND "groupRole" <> 'SUPER_ADMIN') OR ("groupType" IN ('FACILITY', 'CUSTOM') AND "groupRole" IS NULL)))
  OR ("kind" = 'PATIENT_STAFF' AND "clinicId" IS NOT NULL AND "userBId" IS NULL AND "patientAccountId" IS NOT NULL AND "groupType" IS NULL AND "groupName" IS NULL AND "groupRole" IS NULL)
  OR ("kind" = 'ADMIN_SUPER' AND "clinicId" IS NOT NULL AND "userBId" IS NULL AND "patientAccountId" IS NULL AND "groupType" IS NULL AND "groupName" IS NULL AND "groupRole" IS NULL)
);

CREATE UNIQUE INDEX "ChatThread_clinicId_groupName_key" ON "ChatThread"("clinicId", "groupName");
CREATE UNIQUE INDEX "ChatThread_one_facility_room_per_clinic_key" ON "ChatThread"("clinicId") WHERE "kind" = 'STAFF_GROUP' AND "groupType" = 'FACILITY';
CREATE UNIQUE INDEX "ChatThread_one_role_room_per_clinic_key" ON "ChatThread"("clinicId", "groupRole") WHERE "kind" = 'STAFF_GROUP' AND "groupType" = 'ROLE';

CREATE TABLE "ChatThreadMember" (
  "threadId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatThreadMember_pkey" PRIMARY KEY ("threadId", "userId"),
  CONSTRAINT "ChatThreadMember_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatThreadMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ChatThreadMember_userId_threadId_idx" ON "ChatThreadMember"("userId", "threadId");

CREATE TABLE "ChatThreadPin" (
  "threadId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "pinnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatThreadPin_pkey" PRIMARY KEY ("threadId", "userId"),
  CONSTRAINT "ChatThreadPin_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatThreadPin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ChatThreadPin_userId_pinnedAt_idx" ON "ChatThreadPin"("userId", "pinnedAt");
