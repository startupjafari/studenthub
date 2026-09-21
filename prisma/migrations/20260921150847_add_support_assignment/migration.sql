-- AlterTable
ALTER TABLE "chats" ADD COLUMN     "support_assignee_id" TEXT,
ADD COLUMN     "support_first_reply_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "chats_support_assignee_id_idx" ON "chats"("support_assignee_id");
