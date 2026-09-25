-- Usage analytics for the platform operator: who is active, and how sign-ins go.
-- Additive only. Existing users start with no recorded activity.

ALTER TABLE "User"
  ADD COLUMN "lastLoginAt" TIMESTAMP(3),
  ADD COLUMN "lastSeenAt" TIMESTAMP(3);

CREATE TABLE "UserActivityDay" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "day" DATE NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserActivityDay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserActivityDay_userId_day_key" ON "UserActivityDay"("userId", "day");
CREATE INDEX "UserActivityDay_day_idx" ON "UserActivityDay"("day");
CREATE INDEX "UserActivityDay_clinicId_day_idx" ON "UserActivityDay"("clinicId", "day");

ALTER TABLE "UserActivityDay"
  ADD CONSTRAINT "UserActivityDay_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TYPE "LoginOutcome" AS ENUM ('SUCCESS', 'WRONG_PASSWORD', 'BLOCKED');

CREATE TABLE "LoginEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "outcome" "LoginOutcome" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoginEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoginEvent_createdAt_idx" ON "LoginEvent"("createdAt");
CREATE INDEX "LoginEvent_userId_createdAt_idx" ON "LoginEvent"("userId", "createdAt");
CREATE INDEX "LoginEvent_clinicId_createdAt_idx" ON "LoginEvent"("clinicId", "createdAt");
