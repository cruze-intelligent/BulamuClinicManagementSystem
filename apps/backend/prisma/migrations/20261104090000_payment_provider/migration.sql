-- Who carried a patient payment: the mobile money network, the insurer or the bank.
ALTER TABLE "PatientPayment" ADD COLUMN "provider" TEXT;
