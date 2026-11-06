-- AlterTable
ALTER TABLE "users" ADD COLUMN     "left_university_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "users_left_university_at_idx" ON "users"("left_university_at");
