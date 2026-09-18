-- Data migration: the free trial is a facility's first receipt, recorded as a
-- zero-amount, completed Payment (created at approval from now on). Give every
-- facility that was approved before that change its trial receipt too, dated
-- to when its subscription (trial) started, so payment history is complete.
INSERT INTO "Payment" ("id", "clinicId", "subscriptionId", "amount", "currency", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s."clinicId", s."id", 0, s."currency", 'COMPLETED'::"PaymentStatus", s."createdAt", s."createdAt"
FROM "Subscription" s
WHERE NOT EXISTS (
  SELECT 1 FROM "Payment" p WHERE p."subscriptionId" = s."id" AND p."amount" = 0
);
