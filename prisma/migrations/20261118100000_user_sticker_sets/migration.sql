-- Свои стикеры: личные наборы пользователей рядом с каталогом платформы. Только добавления:
-- новые колонки с умолчаниями (у существующих наборов kind = CATALOG, у стикеров — READY),
-- новая таблица «добавленных наборов» и снятие NOT NULL с file_id (пока воркер собирает
-- анимированный стикер, картинки ещё нет). Существующие строки не меняются.

-- CreateEnum
CREATE TYPE "StickerSetKind" AS ENUM ('CATALOG', 'USER');

-- AlterTable
ALTER TABLE "sticker_sets" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "kind" "StickerSetKind" NOT NULL DEFAULT 'CATALOG',
ADD COLUMN     "removed_at" TIMESTAMP(3),
ADD COLUMN     "removed_by_id" TEXT;

-- AlterTable
ALTER TABLE "stickers" ADD COLUMN     "animated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "status" "MediaStatus" NOT NULL DEFAULT 'READY',
ALTER COLUMN "file_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "user_sticker_sets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "set_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sticker_sets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_sticker_sets_user_id_created_at_idx" ON "user_sticker_sets"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "user_sticker_sets_set_id_idx" ON "user_sticker_sets"("set_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_sticker_sets_user_id_set_id_key" ON "user_sticker_sets"("user_id", "set_id");

-- CreateIndex
CREATE INDEX "sticker_sets_removed_by_id_idx" ON "sticker_sets"("removed_by_id");

-- AddForeignKey
ALTER TABLE "sticker_sets" ADD CONSTRAINT "sticker_sets_removed_by_id_fkey" FOREIGN KEY ("removed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sticker_sets" ADD CONSTRAINT "user_sticker_sets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sticker_sets" ADD CONSTRAINT "user_sticker_sets_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "sticker_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
