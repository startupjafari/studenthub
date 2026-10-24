-- Лента сортируется по моменту публикации, а не создания (docs/PROJECT.md §3.3).
--
-- Отложенный пост и опубликованный черновик вставали в ленту на дату, когда их начали
-- писать, — ниже постов, вышедших раньше них. Теперь порядок ленты:
-- `pinned_at DESC NULLS LAST, priority DESC, published_at DESC, id DESC`.
--
-- 1. У опубликованного поста `published_at` обязан быть: репост его раньше не ставил, а
--    строки до появления поля его не имеют. Для них момент публикации и есть момент
--    создания — заполняем им. Черновики и отложенные (`published_at` пуст по смыслу) не
--    трогаем.
UPDATE "posts"
SET "published_at" = "created_at"
WHERE "status" = 'PUBLISHED' AND "published_at" IS NULL;

-- 2. Индекс порядка ленты — тот же, что в 20261010131500_feed_order_index, с published_at
--    вместо created_at. SQL рукописный по той же причине: `NULLS LAST` у первого поля
--    Prisma в DDL теряет, а порядок NULL не моделирует, поэтому дрейфа схемы нет.
--    `published_at DESC` без оговорки — NULLS FIRST, ровно как сортирует `orderBy` ленты.
DROP INDEX "posts_pinned_at_priority_created_at_id_idx";

CREATE INDEX "posts_pinned_at_priority_published_at_id_idx"
  ON "posts" ("pinned_at" DESC NULLS LAST, "priority" DESC, "published_at" DESC, "id" DESC);
