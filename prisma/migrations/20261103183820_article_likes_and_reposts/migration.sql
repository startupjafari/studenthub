-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "shared_article_id" TEXT;

-- CreateTable
CREATE TABLE "article_likes" (
    "id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_likes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "article_likes_user_id_idx" ON "article_likes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "article_likes_article_id_user_id_key" ON "article_likes"("article_id", "user_id");

-- CreateIndex
CREATE INDEX "posts_shared_article_id_idx" ON "posts"("shared_article_id");

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_shared_article_id_fkey" FOREIGN KEY ("shared_article_id") REFERENCES "profile_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_likes" ADD CONSTRAINT "article_likes_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "profile_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_likes" ADD CONSTRAINT "article_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
