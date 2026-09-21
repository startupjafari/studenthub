-- AlterEnum
ALTER TYPE "ChatType" ADD VALUE 'SUPPORT_PLATFORM';

-- AlterTable
ALTER TABLE "chats" ADD COLUMN     "support_closed_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "chats_type_support_closed_at_idx" ON "chats"("type", "support_closed_at");
