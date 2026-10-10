-- Сторисы (Ф14.1, docs/PROJECT.md §3.4): контент на 24 часа с аудиторией, опросом,
-- реакциями и просмотрами. Схема и обоснования решений — prisma/schema/32-stories.prisma.
--
-- Миграция только добавляет: новый enum, шесть таблиц, индексы и внешние ключи.
-- Существующие таблицы не трогаются, данные не переносятся, откат — DROP созданного.

-- CreateEnum
CREATE TYPE "StoryAudience" AS ENUM ('ALL', 'UNIVERSITY', 'FACULTY', 'GROUP', 'TEACHERS');

-- CreateTable
CREATE TABLE "stories" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "audience" "StoryAudience" NOT NULL,
    "university_id" TEXT,
    "faculty_id" TEXT,
    "group_id" TEXT,
    "file_id" TEXT,
    "text" TEXT,
    "background" TEXT,
    "link_url" TEXT,
    "link_label" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_polls" (
    "id" TEXT NOT NULL,
    "story_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_polls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_poll_options" (
    "id" TEXT NOT NULL,
    "poll_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "story_poll_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_poll_votes" (
    "id" TEXT NOT NULL,
    "poll_id" TEXT NOT NULL,
    "option_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_poll_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_views" (
    "id" TEXT NOT NULL,
    "story_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_reactions" (
    "id" TEXT NOT NULL,
    "story_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stories_author_id_idx" ON "stories"("author_id");

-- CreateIndex
CREATE INDEX "stories_audience_idx" ON "stories"("audience");

-- CreateIndex
CREATE INDEX "stories_university_id_idx" ON "stories"("university_id");

-- CreateIndex
CREATE INDEX "stories_faculty_id_idx" ON "stories"("faculty_id");

-- CreateIndex
CREATE INDEX "stories_group_id_idx" ON "stories"("group_id");

-- CreateIndex
CREATE INDEX "stories_file_id_idx" ON "stories"("file_id");

-- CreateIndex
CREATE INDEX "stories_expires_at_created_at_idx" ON "stories"("expires_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "story_polls_story_id_key" ON "story_polls"("story_id");

-- CreateIndex
CREATE INDEX "story_poll_options_poll_id_idx" ON "story_poll_options"("poll_id");

-- CreateIndex
CREATE INDEX "story_poll_votes_option_id_idx" ON "story_poll_votes"("option_id");

-- CreateIndex
CREATE INDEX "story_poll_votes_user_id_idx" ON "story_poll_votes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "story_poll_votes_poll_id_user_id_key" ON "story_poll_votes"("poll_id", "user_id");

-- CreateIndex
CREATE INDEX "story_views_user_id_idx" ON "story_views"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "story_views_story_id_user_id_key" ON "story_views"("story_id", "user_id");

-- CreateIndex
CREATE INDEX "story_reactions_user_id_idx" ON "story_reactions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "story_reactions_story_id_user_id_emoji_key" ON "story_reactions"("story_id", "user_id", "emoji");

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_polls" ADD CONSTRAINT "story_polls_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_poll_options" ADD CONSTRAINT "story_poll_options_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "story_polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_poll_votes" ADD CONSTRAINT "story_poll_votes_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "story_polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_poll_votes" ADD CONSTRAINT "story_poll_votes_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "story_poll_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_poll_votes" ADD CONSTRAINT "story_poll_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_reactions" ADD CONSTRAINT "story_reactions_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_reactions" ADD CONSTRAINT "story_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

