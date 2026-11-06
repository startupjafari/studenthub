-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StoryAudience" ADD VALUE 'FRIENDS';
ALTER TYPE "StoryAudience" ADD VALUE 'SELECTED';

-- AlterTable
ALTER TABLE "stories" ADD COLUMN     "audience_user_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "story_highlights" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "cover_item_id" TEXT,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "story_highlights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_highlight_items" (
    "id" TEXT NOT NULL,
    "highlight_id" TEXT NOT NULL,
    "source_story_id" TEXT,
    "audience" "StoryAudience" NOT NULL,
    "university_id" TEXT,
    "faculty_id" TEXT,
    "group_id" TEXT,
    "audience_user_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "file_id" TEXT,
    "text" TEXT,
    "background" TEXT,
    "link_url" TEXT,
    "link_label" TEXT,
    "elements" JSONB,
    "story_created_at" TIMESTAMP(3) NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_highlight_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "story_highlights_cover_item_id_key" ON "story_highlights"("cover_item_id");

-- CreateIndex
CREATE INDEX "story_highlights_owner_id_position_idx" ON "story_highlights"("owner_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "story_highlight_items_file_id_key" ON "story_highlight_items"("file_id");

-- CreateIndex
CREATE INDEX "story_highlight_items_highlight_id_position_idx" ON "story_highlight_items"("highlight_id", "position");

-- CreateIndex
CREATE INDEX "story_highlight_items_source_story_id_idx" ON "story_highlight_items"("source_story_id");

-- CreateIndex
CREATE INDEX "story_highlight_items_audience_user_ids_idx" ON "story_highlight_items" USING GIN ("audience_user_ids");

-- CreateIndex
CREATE UNIQUE INDEX "story_highlight_items_highlight_id_source_story_id_key" ON "story_highlight_items"("highlight_id", "source_story_id");

-- CreateIndex
CREATE INDEX "stories_audience_user_ids_idx" ON "stories" USING GIN ("audience_user_ids");

-- AddForeignKey
ALTER TABLE "story_highlights" ADD CONSTRAINT "story_highlights_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_highlights" ADD CONSTRAINT "story_highlights_cover_item_id_fkey" FOREIGN KEY ("cover_item_id") REFERENCES "story_highlight_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_highlight_items" ADD CONSTRAINT "story_highlight_items_highlight_id_fkey" FOREIGN KEY ("highlight_id") REFERENCES "story_highlights"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_highlight_items" ADD CONSTRAINT "story_highlight_items_source_story_id_fkey" FOREIGN KEY ("source_story_id") REFERENCES "stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_highlight_items" ADD CONSTRAINT "story_highlight_items_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
