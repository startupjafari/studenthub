-- AlterTable
ALTER TABLE "albums" ADD COLUMN     "university_page_id" TEXT;

-- AlterTable
ALTER TABLE "files" ADD COLUMN     "university_page_id" TEXT;

-- AlterTable
ALTER TABLE "polls" ADD COLUMN     "university_page_id" TEXT;

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "university_page_id" TEXT;

-- AlterTable
ALTER TABLE "profile_articles" ADD COLUMN     "university_page_id" TEXT;

-- AlterTable
ALTER TABLE "universities" ADD COLUMN     "address" TEXT,
ADD COLUMN     "contact_email" TEXT,
ADD COLUMN     "contact_phone" TEXT,
ADD COLUMN     "cover_url" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "founded_year" INTEGER,
ADD COLUMN     "instagram" TEXT,
ADD COLUMN     "linkedin" TEXT,
ADD COLUMN     "logo_url" TEXT,
ADD COLUMN     "telegram" TEXT,
ADD COLUMN     "website" TEXT;

-- CreateIndex
CREATE INDEX "albums_university_page_id_idx" ON "albums"("university_page_id");

-- CreateIndex
CREATE INDEX "files_university_page_id_idx" ON "files"("university_page_id");

-- CreateIndex
CREATE INDEX "polls_university_page_id_created_at_idx" ON "polls"("university_page_id", "created_at");

-- CreateIndex
CREATE INDEX "posts_university_page_id_idx" ON "posts"("university_page_id");

-- CreateIndex
CREATE INDEX "profile_articles_university_page_id_created_at_idx" ON "profile_articles"("university_page_id", "created_at");

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_university_page_id_fkey" FOREIGN KEY ("university_page_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_university_page_id_fkey" FOREIGN KEY ("university_page_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_articles" ADD CONSTRAINT "profile_articles_university_page_id_fkey" FOREIGN KEY ("university_page_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "albums" ADD CONSTRAINT "albums_university_page_id_fkey" FOREIGN KEY ("university_page_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polls" ADD CONSTRAINT "polls_university_page_id_fkey" FOREIGN KEY ("university_page_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

