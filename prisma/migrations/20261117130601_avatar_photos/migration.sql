-- История фото (аватаров) пользователей и групп (§8.3, листание в шапке профиля).
-- Новая таблица + перенос в неё ТЕКУЩИХ аватаров: история начинается с того, что стоит
-- сейчас, и удаление текущего фото сразу знает, что показать вместо него (ничего — пока
-- в истории одна строка). Существующие строки users/chats не меняются.

-- CreateTable
CREATE TABLE "avatar_photos" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "chat_id" TEXT,
    "file_id" TEXT,
    "url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avatar_photos_pkey" PRIMARY KEY ("id"),
    -- Фото принадлежит ровно одному: человеку или группе.
    CONSTRAINT "avatar_photos_owner_check" CHECK (("user_id" IS NULL) <> ("chat_id" IS NULL))
);

-- CreateIndex
CREATE UNIQUE INDEX "avatar_photos_file_id_key" ON "avatar_photos"("file_id");

-- CreateIndex
CREATE INDEX "avatar_photos_user_id_created_at_idx" ON "avatar_photos"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "avatar_photos_chat_id_created_at_idx" ON "avatar_photos"("chat_id", "created_at");

-- AddForeignKey
ALTER TABLE "avatar_photos" ADD CONSTRAINT "avatar_photos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avatar_photos" ADD CONSTRAINT "avatar_photos_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avatar_photos" ADD CONSTRAINT "avatar_photos_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Текущие аватары людей. Файл ищется среди файлов самого человека по ключу в конце URL
-- (ключ — uuid с расширением); не нашёлся (аватар сида без записи File) — строка без файла.
INSERT INTO "avatar_photos" ("id", "user_id", "file_id", "url", "created_at")
SELECT gen_random_uuid()::text, u."id", f."id", u."avatar_url", COALESCE(f."created_at", CURRENT_TIMESTAMP)
FROM "users" u
LEFT JOIN LATERAL (
    SELECT fl."id", fl."created_at"
    FROM "files" fl
    WHERE fl."owner_id" = u."id" AND u."avatar_url" LIKE '%/' || fl."key"
    ORDER BY fl."created_at" DESC
    LIMIT 1
) f ON TRUE
WHERE u."avatar_url" IS NOT NULL AND u."deleted_at" IS NULL
ON CONFLICT DO NOTHING;

-- Текущие фото пользовательских групп. Файл группы записан на её создателя (setChatAvatar).
INSERT INTO "avatar_photos" ("id", "chat_id", "file_id", "url", "created_at")
SELECT gen_random_uuid()::text, c."id", f."id", c."avatar_url", COALESCE(f."created_at", CURRENT_TIMESTAMP)
FROM "chats" c
LEFT JOIN LATERAL (
    SELECT fl."id", fl."created_at"
    FROM "files" fl
    WHERE fl."owner_id" = c."created_by_id" AND c."avatar_url" LIKE '%/' || fl."key"
    ORDER BY fl."created_at" DESC
    LIMIT 1
) f ON TRUE
WHERE c."avatar_url" IS NOT NULL
ON CONFLICT DO NOTHING;
