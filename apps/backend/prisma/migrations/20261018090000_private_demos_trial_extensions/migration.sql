-- Additive. Each demo is now private to the person it was sent to and closes
-- after 14 days; a demo created before this change gets the same 14 days from now.
ALTER TABLE "Clinic" ADD COLUMN "demoExpiresAt" TIMESTAMP(3);
UPDATE "Clinic" SET "demoExpiresAt" = NOW() + INTERVAL '14 days' WHERE "isDemo" AND "demoExpiresAt" IS NULL;

-- Days the platform operator has added to a facility's free trial (at most 14 in all).
ALTER TABLE "Subscription" ADD COLUMN "trialExtendedDays" INTEGER NOT NULL DEFAULT 0;

-- A demo keeps only how it was used, never who it was sent to: drop the
-- recipient addresses the earlier demo flow wrote into the audit log.
UPDATE "AuditLog" SET "metadata" = "metadata" - 'loginsSentTo' WHERE "metadata" ? 'loginsSentTo';
