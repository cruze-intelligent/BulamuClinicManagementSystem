-- Uploaded documents' bytes move into the database, so they survive restarts
-- and redeploys of the API host (whose disk is wiped on each one).

-- CreateTable
CREATE TABLE "StoredFile" (
    "storageKey" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("storageKey")
);

