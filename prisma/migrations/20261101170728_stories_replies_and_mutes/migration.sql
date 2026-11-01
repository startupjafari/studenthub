-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "shared_story_id" TEXT,
ADD COLUMN     "shared_story_reply" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "story_mutes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "muted_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_mutes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "story_mutes_muted_user_id_idx" ON "story_mutes"("muted_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "story_mutes_user_id_muted_user_id_key" ON "story_mutes"("user_id", "muted_user_id");

-- CreateIndex
CREATE INDEX "messages_shared_story_id_idx" ON "messages"("shared_story_id");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_shared_story_id_fkey" FOREIGN KEY ("shared_story_id") REFERENCES "stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_mutes" ADD CONSTRAINT "story_mutes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_mutes" ADD CONSTRAINT "story_mutes_muted_user_id_fkey" FOREIGN KEY ("muted_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
