-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('STANDARD', 'CUSTOM');

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "plan" "SubscriptionPlan" NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "Subscription" ADD COLUMN "planNotes" TEXT;
