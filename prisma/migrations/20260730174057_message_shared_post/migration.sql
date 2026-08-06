-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "shared_post_id" TEXT;

-- CreateIndex
CREATE INDEX "messages_shared_post_id_idx" ON "messages"("shared_post_id");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_shared_post_id_fkey" FOREIGN KEY ("shared_post_id") REFERENCES "posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

