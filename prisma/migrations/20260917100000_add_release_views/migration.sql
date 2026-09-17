-- Отметка о прочтении «Что нового» (docs/RELEASE.md): одна строка на пользователя,
-- версия последнего релиза, который человек подтвердил кнопкой «Понятно».
-- Аддитивная миграция: новая таблица, существующие не трогаются, откат кода на
-- предыдущий релиз безопасен — таблица просто перестаёт читаться.

-- CreateTable
CREATE TABLE "release_views" (
    "user_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "release_views_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "release_views" ADD CONSTRAINT "release_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
