-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "sticker_id" TEXT;

-- AlterTable
ALTER TABLE "chat_polls" ADD COLUMN     "description" TEXT;

-- CreateTable
CREATE TABLE "hidden_messages" (
    "user_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hidden_messages_pkey" PRIMARY KEY ("user_id","message_id")
);

-- CreateTable
CREATE TABLE "chat_locations" (
    "message_id" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "title" TEXT,
    "address" TEXT,

    CONSTRAINT "chat_locations_pkey" PRIMARY KEY ("message_id")
);

-- CreateTable
CREATE TABLE "chat_contacts" (
    "message_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "user_id" TEXT,

    CONSTRAINT "chat_contacts_pkey" PRIMARY KEY ("message_id")
);

-- CreateTable
CREATE TABLE "chat_checklists" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "others_can_add" BOOLEAN NOT NULL DEFAULT true,
    "others_can_mark" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_checklist_items" (
    "id" TEXT NOT NULL,
    "checklist_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "done_by_id" TEXT,
    "done_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sticker_sets" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sticker_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stickers" (
    "id" TEXT NOT NULL,
    "set_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "emoji" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER,
    "height" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stickers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hidden_messages_message_id_idx" ON "hidden_messages"("message_id");

-- CreateIndex
CREATE INDEX "chat_contacts_user_id_idx" ON "chat_contacts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_checklists_message_id_key" ON "chat_checklists"("message_id");

-- CreateIndex
CREATE INDEX "chat_checklist_items_checklist_id_order_idx" ON "chat_checklist_items"("checklist_id", "order");

-- CreateIndex
CREATE INDEX "chat_checklist_items_done_by_id_idx" ON "chat_checklist_items"("done_by_id");

-- CreateIndex
CREATE INDEX "chat_checklist_items_created_by_id_idx" ON "chat_checklist_items"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "sticker_sets_slug_key" ON "sticker_sets"("slug");

-- CreateIndex
CREATE INDEX "sticker_sets_is_published_order_idx" ON "sticker_sets"("is_published", "order");

-- CreateIndex
CREATE INDEX "sticker_sets_created_by_id_idx" ON "sticker_sets"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "stickers_file_id_key" ON "stickers"("file_id");

-- CreateIndex
CREATE INDEX "stickers_set_id_order_idx" ON "stickers"("set_id", "order");

-- CreateIndex
CREATE INDEX "messages_sticker_id_idx" ON "messages"("sticker_id");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sticker_id_fkey" FOREIGN KEY ("sticker_id") REFERENCES "stickers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hidden_messages" ADD CONSTRAINT "hidden_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hidden_messages" ADD CONSTRAINT "hidden_messages_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_locations" ADD CONSTRAINT "chat_locations_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_contacts" ADD CONSTRAINT "chat_contacts_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_contacts" ADD CONSTRAINT "chat_contacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_checklists" ADD CONSTRAINT "chat_checklists_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_checklist_items" ADD CONSTRAINT "chat_checklist_items_checklist_id_fkey" FOREIGN KEY ("checklist_id") REFERENCES "chat_checklists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_checklist_items" ADD CONSTRAINT "chat_checklist_items_done_by_id_fkey" FOREIGN KEY ("done_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_checklist_items" ADD CONSTRAINT "chat_checklist_items_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sticker_sets" ADD CONSTRAINT "sticker_sets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stickers" ADD CONSTRAINT "stickers_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "sticker_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stickers" ADD CONSTRAINT "stickers_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

