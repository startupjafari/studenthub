-- CreateTable
CREATE TABLE "chat_polls" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "multiple" BOOLEAN NOT NULL DEFAULT false,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "allow_revote" BOOLEAN NOT NULL DEFAULT true,
    "random_order" BOOLEAN NOT NULL DEFAULT false,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_polls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_poll_options" (
    "id" TEXT NOT NULL,
    "poll_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "chat_poll_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_poll_votes" (
    "id" TEXT NOT NULL,
    "poll_id" TEXT NOT NULL,
    "option_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_poll_votes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_polls_message_id_key" ON "chat_polls"("message_id");

-- CreateIndex
CREATE INDEX "chat_poll_options_poll_id_idx" ON "chat_poll_options"("poll_id");

-- CreateIndex
CREATE INDEX "chat_poll_votes_poll_id_user_id_idx" ON "chat_poll_votes"("poll_id", "user_id");

-- CreateIndex
CREATE INDEX "chat_poll_votes_user_id_idx" ON "chat_poll_votes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_poll_votes_option_id_user_id_key" ON "chat_poll_votes"("option_id", "user_id");

-- AddForeignKey
ALTER TABLE "chat_polls" ADD CONSTRAINT "chat_polls_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_poll_options" ADD CONSTRAINT "chat_poll_options_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "chat_polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_poll_votes" ADD CONSTRAINT "chat_poll_votes_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "chat_polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_poll_votes" ADD CONSTRAINT "chat_poll_votes_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "chat_poll_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_poll_votes" ADD CONSTRAINT "chat_poll_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
