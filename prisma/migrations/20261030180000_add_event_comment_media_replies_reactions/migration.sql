-- Обсуждение события как чат: вложения (files.event_comment_id), ответ на комментарий
-- (event_comments.reply_to_id) и реакции (event_comment_reactions). Только добавления.

-- AlterTable
ALTER TABLE "event_comments" ADD COLUMN     "reply_to_id" TEXT;

-- AlterTable
ALTER TABLE "files" ADD COLUMN     "event_comment_id" TEXT;

-- CreateTable
CREATE TABLE "event_comment_reactions" (
    "id" TEXT NOT NULL,
    "comment_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_comment_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_comment_reactions_comment_id_idx" ON "event_comment_reactions"("comment_id");

-- CreateIndex
CREATE INDEX "event_comment_reactions_user_id_idx" ON "event_comment_reactions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_comment_reactions_comment_id_user_id_emoji_key" ON "event_comment_reactions"("comment_id", "user_id", "emoji");

-- CreateIndex
CREATE INDEX "event_comments_reply_to_id_idx" ON "event_comments"("reply_to_id");

-- CreateIndex
CREATE INDEX "files_event_comment_id_idx" ON "files"("event_comment_id");

-- AddForeignKey
ALTER TABLE "event_comments" ADD CONSTRAINT "event_comments_reply_to_id_fkey" FOREIGN KEY ("reply_to_id") REFERENCES "event_comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_comment_reactions" ADD CONSTRAINT "event_comment_reactions_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "event_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_comment_reactions" ADD CONSTRAINT "event_comment_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_event_comment_id_fkey" FOREIGN KEY ("event_comment_id") REFERENCES "event_comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

