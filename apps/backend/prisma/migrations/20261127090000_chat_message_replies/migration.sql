ALTER TABLE "ChatMessage" ADD COLUMN "replyToMessageId" TEXT;

CREATE INDEX "ChatMessage_replyToMessageId_idx" ON "ChatMessage"("replyToMessageId");

ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_replyToMessageId_fkey" FOREIGN KEY ("replyToMessageId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
