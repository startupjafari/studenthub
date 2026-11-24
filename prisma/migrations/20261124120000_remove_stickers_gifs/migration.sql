-- Стикеры и GIF убраны из продукта целиком: каталог и личные наборы, избранное, «Мои GIF»,
-- поиск GIPHY и показ GIF-вложений анимацией. Прикреплённый .gif теперь обычная картинка.
--
-- Данные:
-- - сообщения-стикеры текста не несут — без стикера им нечего показывать, поэтому они
--   мягко удаляются, как «удалить для всех»;
-- - жалобы на наборы стикеров уходят вместе с целью;
-- - строки File стикеров и «Моих GIF» остаются без владельца и снимаются обычной уборкой
--   (cleanDetachedFiles → cleanOrphanFiles). Объект сохранённого GIF общий с исходным
--   вложением — по нему есть живая строка, и уборка его не трогает;
-- - флаг files.animation удаляется: бывшие GIF, переведённые в MP4, показываются роликом.

UPDATE "messages" SET "deleted_at" = now() WHERE "sticker_id" IS NOT NULL AND "deleted_at" IS NULL;

DELETE FROM "complaints" WHERE "target_type" = 'STICKER_SET';

-- AlterEnum
BEGIN;
CREATE TYPE "ComplaintTargetType_new" AS ENUM ('POST', 'STORY', 'COMMENT', 'MESSAGE', 'USER', 'CHAT');
ALTER TABLE "complaints" ALTER COLUMN "target_type" TYPE "ComplaintTargetType_new" USING ("target_type"::text::"ComplaintTargetType_new");
ALTER TYPE "ComplaintTargetType" RENAME TO "ComplaintTargetType_old";
ALTER TYPE "ComplaintTargetType_new" RENAME TO "ComplaintTargetType";
DROP TYPE "ComplaintTargetType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "messages" DROP CONSTRAINT "messages_sticker_id_fkey";

-- DropForeignKey
ALTER TABLE "sticker_sets" DROP CONSTRAINT "sticker_sets_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "sticker_sets" DROP CONSTRAINT "sticker_sets_removed_by_id_fkey";

-- DropForeignKey
ALTER TABLE "stickers" DROP CONSTRAINT "stickers_set_id_fkey";

-- DropForeignKey
ALTER TABLE "stickers" DROP CONSTRAINT "stickers_file_id_fkey";

-- DropForeignKey
ALTER TABLE "favorite_stickers" DROP CONSTRAINT "favorite_stickers_user_id_fkey";

-- DropForeignKey
ALTER TABLE "favorite_stickers" DROP CONSTRAINT "favorite_stickers_sticker_id_fkey";

-- DropForeignKey
ALTER TABLE "saved_gifs" DROP CONSTRAINT "saved_gifs_user_id_fkey";

-- DropForeignKey
ALTER TABLE "saved_gifs" DROP CONSTRAINT "saved_gifs_file_id_fkey";

-- DropForeignKey
ALTER TABLE "user_sticker_sets" DROP CONSTRAINT "user_sticker_sets_user_id_fkey";

-- DropForeignKey
ALTER TABLE "user_sticker_sets" DROP CONSTRAINT "user_sticker_sets_set_id_fkey";

-- DropIndex
DROP INDEX "messages_sticker_id_idx";

-- AlterTable
ALTER TABLE "messages" DROP COLUMN "sticker_id";

-- AlterTable
ALTER TABLE "files" DROP COLUMN "animation";

-- DropTable
DROP TABLE "sticker_sets";

-- DropTable
DROP TABLE "stickers";

-- DropTable
DROP TABLE "favorite_stickers";

-- DropTable
DROP TABLE "saved_gifs";

-- DropTable
DROP TABLE "user_sticker_sets";

-- DropEnum
DROP TYPE "StickerSetKind";

