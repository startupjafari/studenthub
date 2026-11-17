-- Поиск в чатах по имени файла (вкладки «Файлы» и «Музыка» глобального поиска, Telegram-стиль):
-- подстрока без регистра (ILIKE '%…%'), её B-tree не ищет. Триграммный GIN-индекс по files.name.
-- pg_trgm — стандартное расширение PostgreSQL (contrib, «trusted» с PG13: владелец базы ставит
-- его без суперпользователя). Только добавление: ничего не удаляется и не переписывается.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "files_name_trgm_idx" ON "files" USING GIN ("name" gin_trgm_ops);
