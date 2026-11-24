-- Keep each group member's own read position. ChatMessage.readAt remains the
-- first-read marker for direct and admin-support conversations.
CREATE TABLE "ChatThreadRead" (
  "threadId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "lastReadAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChatThreadRead_pkey" PRIMARY KEY ("threadId", "userId"),
  CONSTRAINT "ChatThreadRead_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatThreadRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ChatThreadRead_userId_threadId_idx" ON "ChatThreadRead"("userId", "threadId");
