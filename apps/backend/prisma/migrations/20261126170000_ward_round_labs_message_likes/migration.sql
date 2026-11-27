ALTER TABLE "LabTest"
  ADD COLUMN "admissionId" TEXT;

CREATE INDEX "LabTest_admissionId_idx" ON "LabTest"("admissionId");

ALTER TABLE "LabTest"
  ADD CONSTRAINT "LabTest_admissionId_fkey"
  FOREIGN KEY ("admissionId") REFERENCES "Admission"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ChatMessageLike" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "userId" TEXT,
  "patientAccountId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatMessageLike_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatMessageLike_exactly_one_actor_check"
    CHECK (("userId" IS NULL) <> ("patientAccountId" IS NULL))
);

CREATE UNIQUE INDEX "ChatMessageLike_messageId_userId_key"
  ON "ChatMessageLike"("messageId", "userId");
CREATE UNIQUE INDEX "ChatMessageLike_messageId_patientAccountId_key"
  ON "ChatMessageLike"("messageId", "patientAccountId");
CREATE INDEX "ChatMessageLike_messageId_idx" ON "ChatMessageLike"("messageId");

ALTER TABLE "ChatMessageLike"
  ADD CONSTRAINT "ChatMessageLike_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessageLike"
  ADD CONSTRAINT "ChatMessageLike_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessageLike"
  ADD CONSTRAINT "ChatMessageLike_patientAccountId_fkey"
  FOREIGN KEY ("patientAccountId") REFERENCES "PatientAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
