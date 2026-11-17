-- Непрочитанные упоминания и реакции (Telegram: unreadMentionsCount / unreadReactionsCount).
-- Только новый тип и новая таблица, существующие таблицы не меняются. Бэкфилла нет: счёт
-- начинается с пустой таблицы, прошлые упоминания и реакции считаются просмотренными.

-- CreateEnum
CREATE TYPE "ChatAttentionKind" AS ENUM ('MENTION', 'REACTION');

-- CreateTable
CREATE TABLE "chat_attention" (
    "id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "kind" "ChatAttentionKind" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_attention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_attention_user_id_chat_id_kind_idx" ON "chat_attention"("user_id", "chat_id", "kind");

-- CreateIndex
CREATE INDEX "chat_attention_message_id_idx" ON "chat_attention"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_attention_user_id_message_id_kind_key" ON "chat_attention"("user_id", "message_id", "kind");

-- AddForeignKey
ALTER TABLE "chat_attention" ADD CONSTRAINT "chat_attention_chat_id_user_id_fkey" FOREIGN KEY ("chat_id", "user_id") REFERENCES "chat_members"("chat_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_attention" ADD CONSTRAINT "chat_attention_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
