-- Репосты убраны из продукта целиком: и репост поста (цитата оригинала), и репост статьи
-- профиля в ленту (карточка статьи).
--
-- Данные: посты-репосты мягко удаляются, как «удалить» автором, — без цитаты или карточки
-- от них осталась бы одна подпись, чаще всего пустая. Жёсткое удаление не годится: на эти
-- посты могут ссылаться жалобы, уведомления и пересылки в чаты, а у них нет внешнего ключа.

UPDATE "posts" SET "deleted_at" = now()
WHERE ("original_post_id" IS NOT NULL OR "shared_article_id" IS NOT NULL) AND "deleted_at" IS NULL;

-- DropForeignKey
ALTER TABLE "posts" DROP CONSTRAINT "posts_original_post_id_fkey";

-- DropForeignKey
ALTER TABLE "posts" DROP CONSTRAINT "posts_shared_article_id_fkey";

-- DropIndex
DROP INDEX "posts_original_post_id_idx";

-- DropIndex
DROP INDEX "posts_shared_article_id_idx";

-- AlterTable
ALTER TABLE "posts" DROP COLUMN "original_post_id",
DROP COLUMN "shared_article_id";
