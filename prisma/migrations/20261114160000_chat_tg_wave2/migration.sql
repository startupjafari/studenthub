-- AlterTable
ALTER TABLE "chat_members" ADD COLUMN     "marked_unread_at" TIMESTAMP(3),
ADD COLUMN     "pinned_order" INTEGER;

-- AlterTable
ALTER TABLE "chat_folders" ADD COLUMN     "color" INTEGER,
ADD COLUMN     "emoji" TEXT,
ADD COLUMN     "include_contacts" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "include_groups" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "include_non_contacts" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "chat_folder_items" ADD COLUMN     "excluded" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "favorite_stickers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sticker_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorite_stickers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "favorite_stickers_user_id_created_at_idx" ON "favorite_stickers"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "favorite_stickers_sticker_id_idx" ON "favorite_stickers"("sticker_id");

-- CreateIndex
CREATE UNIQUE INDEX "favorite_stickers_user_id_sticker_id_key" ON "favorite_stickers"("user_id", "sticker_id");

-- AddForeignKey
ALTER TABLE "favorite_stickers" ADD CONSTRAINT "favorite_stickers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite_stickers" ADD CONSTRAINT "favorite_stickers_sticker_id_fkey" FOREIGN KEY ("sticker_id") REFERENCES "stickers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

