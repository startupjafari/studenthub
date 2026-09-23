-- AlterTable
ALTER TABLE "chats" ADD COLUMN     "support_merged_into_id" TEXT;

-- CreateIndex
CREATE INDEX "chats_support_merged_into_id_idx" ON "chats"("support_merged_into_id");
