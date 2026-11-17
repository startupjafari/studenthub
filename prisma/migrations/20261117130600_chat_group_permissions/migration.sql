-- Группы как в Telegram (§8.3): разрешения участников, вступление по ссылке и заявки,
-- список исключённых. Только добавления: новые колонки с умолчаниями и новые таблицы.

-- AlterTable
ALTER TABLE "chats" ADD COLUMN     "join_approval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "join_by_link" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "permissions" JSONB;

-- CreateTable
CREATE TABLE "chat_join_requests" (
    "id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_join_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_removed_members" (
    "id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "removed_by_id" TEXT,
    "removed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_removed_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_join_requests_chat_id_created_at_idx" ON "chat_join_requests"("chat_id", "created_at");

-- CreateIndex
CREATE INDEX "chat_join_requests_user_id_idx" ON "chat_join_requests"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_join_requests_chat_id_user_id_key" ON "chat_join_requests"("chat_id", "user_id");

-- CreateIndex
CREATE INDEX "chat_removed_members_chat_id_removed_at_idx" ON "chat_removed_members"("chat_id", "removed_at");

-- CreateIndex
CREATE INDEX "chat_removed_members_user_id_idx" ON "chat_removed_members"("user_id");

-- CreateIndex
CREATE INDEX "chat_removed_members_removed_by_id_idx" ON "chat_removed_members"("removed_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_removed_members_chat_id_user_id_key" ON "chat_removed_members"("chat_id", "user_id");

-- AddForeignKey
ALTER TABLE "chat_join_requests" ADD CONSTRAINT "chat_join_requests_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_join_requests" ADD CONSTRAINT "chat_join_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_removed_members" ADD CONSTRAINT "chat_removed_members_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_removed_members" ADD CONSTRAINT "chat_removed_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_removed_members" ADD CONSTRAINT "chat_removed_members_removed_by_id_fkey" FOREIGN KEY ("removed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
