-- CreateTable
CREATE TABLE "profile_articles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profile_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_qa" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profile_qa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "profile_articles_user_id_created_at_idx" ON "profile_articles"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "profile_qa_user_id_created_at_idx" ON "profile_qa"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "profile_articles" ADD CONSTRAINT "profile_articles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_qa" ADD CONSTRAINT "profile_qa_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
