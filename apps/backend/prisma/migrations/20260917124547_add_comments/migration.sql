-- CreateEnum
CREATE TYPE "CommentEntityType" AS ENUM ('FEEDBACK', 'PATIENT');

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorRole" "Role" NOT NULL,
    "entityType" "CommentEntityType" NOT NULL,
    "entityId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Comment_clinicId_entityType_entityId_idx" ON "Comment"("clinicId", "entityType", "entityId");

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
