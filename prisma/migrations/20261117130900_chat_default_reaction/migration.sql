-- Своя быстрая реакция в чатах (двойной клик/касание). NULL — общая по умолчанию.
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "chat_default_reaction" TEXT;
