-- CreateTable
CREATE TABLE "chat_folders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_folder_items" (
    "id" TEXT NOT NULL,
    "folder_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_folder_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_folders_user_id_idx" ON "chat_folders"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_folders_user_id_name_key" ON "chat_folders"("user_id", "name");

-- CreateIndex
CREATE INDEX "chat_folder_items_chat_id_idx" ON "chat_folder_items"("chat_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_folder_items_folder_id_chat_id_key" ON "chat_folder_items"("folder_id", "chat_id");

-- AddForeignKey
ALTER TABLE "chat_folders" ADD CONSTRAINT "chat_folders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_folder_items" ADD CONSTRAINT "chat_folder_items_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "chat_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_folder_items" ADD CONSTRAINT "chat_folder_items_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

