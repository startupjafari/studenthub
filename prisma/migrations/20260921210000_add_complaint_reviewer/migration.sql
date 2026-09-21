-- AlterTable
ALTER TABLE "complaints" ADD COLUMN     "reviewing_by_id" TEXT;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_reviewing_by_id_fkey" FOREIGN KEY ("reviewing_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
