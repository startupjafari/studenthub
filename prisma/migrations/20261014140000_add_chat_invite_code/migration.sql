-- Код ссылки-приглашения в пользовательскую группу вместо id чата.
--
-- Одна nullable-колонка с уникальным индексом: существующие строки получают NULL и не
-- меняются; старые ссылки вида /join-chat/<id> перестают пускать (это и есть цель),
-- админ группы выдаёт новую. Откат — DROP COLUMN.

-- AlterTable
ALTER TABLE "chats" ADD COLUMN     "invite_code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "chats_invite_code_key" ON "chats"("invite_code");

