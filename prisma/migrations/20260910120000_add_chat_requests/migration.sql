-- AlterTable
ALTER TABLE "chats" ADD COLUMN     "request_pending_for_id" TEXT;

-- CreateIndex
CREATE INDEX "chats_request_pending_for_id_idx" ON "chats"("request_pending_for_id");
