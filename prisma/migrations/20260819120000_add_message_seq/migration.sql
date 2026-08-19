-- Монотонный номер сообщения внутри чата (Message.seq) + аллокатор (Chat.last_seq).
-- Нужен для дельта-догона после обрыва связи: GET /chats/:id/updates?since=<seq>.
--
-- Порядок шагов важен: колонка добавляется с временным DEFAULT (таблица непустая),
-- затем бекфилл, затем DEFAULT снимается, и только после этого создаётся UNIQUE-индекс —
-- иначе существующие строки столкнулись бы на общем значении 0.

-- AlterTable
ALTER TABLE "chats" ADD COLUMN     "last_seq" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "seq" INTEGER NOT NULL DEFAULT 0;

-- Бекфилл: сквозная нумерация в порядке создания внутри каждого чата.
UPDATE "messages" m
SET "seq" = s.rn
FROM (
  SELECT id, row_number() OVER (PARTITION BY chat_id ORDER BY created_at, id) AS rn
  FROM "messages"
) s
WHERE m.id = s.id;

-- Аллокатор продолжает нумерацию с последнего выданного значения.
UPDATE "chats" c
SET "last_seq" = s.max_seq
FROM (SELECT chat_id, MAX(seq) AS max_seq FROM "messages" GROUP BY chat_id) s
WHERE c.id = s.chat_id;

-- Дальше seq всегда задаётся явно (Chat.last_seq), значение по умолчанию больше не нужно.
ALTER TABLE "messages" ALTER COLUMN "seq" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "messages_chat_id_seq_key" ON "messages"("chat_id", "seq");
