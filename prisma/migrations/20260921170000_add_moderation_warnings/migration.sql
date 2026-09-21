-- AlterTable
ALTER TABLE "users" ADD COLUMN     "blocked_until" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "moderation_warnings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "issued_by_id" TEXT,
    "complaint_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_warnings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "moderation_warnings_user_id_created_at_idx" ON "moderation_warnings"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "moderation_warnings" ADD CONSTRAINT "moderation_warnings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_warnings" ADD CONSTRAINT "moderation_warnings_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_warnings" ADD CONSTRAINT "moderation_warnings_complaint_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "complaints"("id") ON DELETE SET NULL ON UPDATE CASCADE;
