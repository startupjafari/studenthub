-- AlterTable
ALTER TABLE "library_id_access_logs" ADD COLUMN     "without_phone" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "loans" ADD COLUMN     "without_phone" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "loans_university_id_without_phone_issued_at_idx" ON "loans"("university_id", "without_phone", "issued_at");
