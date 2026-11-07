-- CreateEnum
CREATE TYPE "SubscriptionPaymentMethod" AS ENUM ('PESAPAL', 'CASH');

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "graceDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "graceFrom" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "method" "SubscriptionPaymentMethod" NOT NULL DEFAULT 'PESAPAL',
ADD COLUMN     "months" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "paidBy" TEXT,
ADD COLUMN     "recordedBy" TEXT,
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "requestKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_requestKey_key" ON "Payment"("requestKey");

