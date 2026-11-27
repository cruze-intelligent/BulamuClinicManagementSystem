CREATE TABLE "PersonalNote" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "patientAccountId" TEXT,
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "reminderAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalNote_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PersonalNote_one_owner_check" CHECK (("userId" IS NOT NULL) <> ("patientAccountId" IS NOT NULL))
);

CREATE INDEX "PersonalNote_userId_createdAt_idx" ON "PersonalNote"("userId", "createdAt");
CREATE INDEX "PersonalNote_userId_reminderAt_completedAt_idx" ON "PersonalNote"("userId", "reminderAt", "completedAt");
CREATE INDEX "PersonalNote_patientAccountId_createdAt_idx" ON "PersonalNote"("patientAccountId", "createdAt");
CREATE INDEX "PersonalNote_patientAccountId_reminderAt_completedAt_idx" ON "PersonalNote"("patientAccountId", "reminderAt", "completedAt");

ALTER TABLE "PersonalNote" ADD CONSTRAINT "PersonalNote_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalNote" ADD CONSTRAINT "PersonalNote_patientAccountId_fkey"
    FOREIGN KEY ("patientAccountId") REFERENCES "PatientAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
