-- AlterTable
ALTER TABLE "loans" ADD COLUMN     "lost_settled_at" TIMESTAMP(3),
ADD COLUMN     "lost_settled_by_id" TEXT;

-- CreateIndex
CREATE INDEX "loans_lost_settled_by_id_idx" ON "loans"("lost_settled_by_id");

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_lost_settled_by_id_fkey" FOREIGN KEY ("lost_settled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
