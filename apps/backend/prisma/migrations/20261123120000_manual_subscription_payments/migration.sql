-- Subscription payments recorded by a Bulamu administrator: mobile money and bank transfers too, with the network or bank.
ALTER TYPE "SubscriptionPaymentMethod" ADD VALUE IF NOT EXISTS 'MOBILE_MONEY';
ALTER TYPE "SubscriptionPaymentMethod" ADD VALUE IF NOT EXISTS 'BANK_TRANSFER';
ALTER TABLE "Payment" ADD COLUMN "provider" TEXT;
