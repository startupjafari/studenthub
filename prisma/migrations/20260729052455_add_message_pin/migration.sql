-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "pinned_at" TIMESTAMP(3),
ADD COLUMN     "pinned_by_id" TEXT;

-- CreateIndex
CREATE INDEX "messages_pinned_by_id_idx" ON "messages"("pinned_by_id");

-- CreateIndex
CREATE INDEX "messages_chat_id_pinned_at_idx" ON "messages"("chat_id", "pinned_at");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_pinned_by_id_fkey" FOREIGN KEY ("pinned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

