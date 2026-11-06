-- AlterEnum
ALTER TYPE "PostAudience" ADD VALUE 'COMPANY';

-- AlterTable
ALTER TABLE "albums" ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "address" TEXT,
ADD COLUMN     "contact_email" TEXT,
ADD COLUMN     "contact_phone" TEXT,
ADD COLUMN     "cover_url" TEXT,
ADD COLUMN     "founded_year" INTEGER,
ADD COLUMN     "industry" TEXT,
ADD COLUMN     "instagram" TEXT,
ADD COLUMN     "linkedin" TEXT,
ADD COLUMN     "size" TEXT,
ADD COLUMN     "telegram" TEXT;

-- AlterTable
ALTER TABLE "files" ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "polls" ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "company_id" TEXT;

-- AlterTable
ALTER TABLE "profile_articles" ADD COLUMN     "company_id" TEXT;

-- CreateIndex
CREATE INDEX "albums_company_id_idx" ON "albums"("company_id");

-- CreateIndex
CREATE INDEX "files_company_id_idx" ON "files"("company_id");

-- CreateIndex
CREATE INDEX "polls_company_id_created_at_idx" ON "polls"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "posts_company_id_idx" ON "posts"("company_id");

-- CreateIndex
CREATE INDEX "profile_articles_company_id_created_at_idx" ON "profile_articles"("company_id", "created_at");

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_articles" ADD CONSTRAINT "profile_articles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "albums" ADD CONSTRAINT "albums_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polls" ADD CONSTRAINT "polls_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

